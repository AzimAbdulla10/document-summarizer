"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { useOcr } from "@/hooks/useOcr";

interface SummaryData {
  summary: string;
  keyPoints: string[];
  improvementSuggestions: string[];
}

interface HistoryItem {
  id: string;
  filename: string;
  filetype: string;
  filesize: string;
  date: string;
  extractedText: string;
  summaryData: SummaryData;
  length: "short" | "medium" | "long";
  status: "Complete" | "Failed";
}

export default function Home() {
  // Navigation State
  const [view, setView] = useState<"workspace" | "history">("workspace");

  // Mobile Workspace Navigation Toggle
  const [workspaceMode, setWorkspaceMode] = useState<"source" | "summary">("source");

  // Dark Mode State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("doc_summarizer_theme") === "dark";
    }
    return false;
  });

  const toggleDarkMode = () => {
    const nextVal = !isDarkMode;
    setIsDarkMode(nextVal);
    localStorage.setItem("doc_summarizer_theme", nextVal ? "dark" : "light");
  };

  // File states
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // App workspace states
  const [extractedText, setExtractedText] = useState("");
  const [numPages, setNumPages] = useState<number | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  // AI Summarization states
  const [summaryLength, setSummaryLength] = useState<"short" | "medium" | "long">("medium");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "keypoints" | "suggestions">("summary");

  // Tesseract hook
  const { runOcr, isProcessing: isOcrProcessing, progress: ocrProgress, status: ocrStatus } = useOcr();

  // History State
  const [historyList, setHistoryList] = useState<HistoryItem[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("doc_summarizer_history");
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          console.error("Failed to parse history log", e);
        }
      }
    }
    return [];
  });
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");

  // Save history helper
  const saveToHistory = (newItem: HistoryItem) => {
    const updated = [newItem, ...historyList];
    setHistoryList(updated);
    localStorage.setItem("doc_summarizer_history", JSON.stringify(updated));
  };

  // Delete history item helper
  const deleteHistoryItem = (id: string) => {
    const updated = historyList.filter(item => item.id !== id);
    setHistoryList(updated);
    localStorage.setItem("doc_summarizer_history", JSON.stringify(updated));
    setSelectedHistoryItem(null);
  };

  // Drag and Drop handlers
  const handleDrag = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndProcessFile(droppedFile);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const validateAndProcessFile = (selectedFile: File) => {
    const isPdf = selectedFile.type === "application/pdf" || selectedFile.name.toLowerCase().endsWith(".pdf");
    const isImage = selectedFile.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(selectedFile.name);

    if (!isPdf && !isImage) {
      setExtractionError("Unsupported file type. Please upload a PDF or an Image file (PNG, JPG, JPEG).");
      return;
    }

    setFile(selectedFile);
    setExtractedText("");
    setNumPages(null);
    setSummaryData(null);
    setExtractionError(null);
    setSummaryError(null);
    setView("workspace");
    setWorkspaceMode("source");

    if (isPdf) {
      extractTextFromPdf(selectedFile);
    } else {
      extractTextFromImage(selectedFile);
    }
  };

  // Load PDF.js dynamically on the client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadPdfJs = async (): Promise<any> => {
    if (typeof window === "undefined") return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (win.pdfjsLib) return win.pdfjsLib;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js";
      script.onload = () => {
        win.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
        resolve(win.pdfjsLib);
      };
      script.onerror = () => reject(new Error("Failed to load PDF parsing engine. Check your internet connection."));
      document.head.appendChild(script);
    });
  };

  // PDF Text Extraction via client-side PDF.js
  const extractTextFromPdf = async (pdfFile: File) => {
    setIsExtracting(true);
    setExtractionError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pdfjs: any;
      try {
        pdfjs = await loadPdfJs();
      } catch {
        throw new Error("Failed to load PDF helper engine from CDN. Please check your internet connection.");
      }

      const arrayBuffer = await pdfFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      
      setNumPages(pdfDoc.numPages);

      let fullText = "";
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        fullText += pageText + "\n\n";
      }

      if (!fullText.trim()) {
        throw new Error("This PDF appears to have no machine-readable text. If it is a scanned document, try converting it to images and using OCR.");
      }

      setExtractedText(fullText);
      await handleSummarizeWithText(fullText, pdfFile);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred while parsing the PDF.";
      setExtractionError(errorMessage);
      saveFailedRun(pdfFile, "PDF");
    } finally {
      setIsExtracting(false);
    }
  };

  // Image Text Extraction via client-side OCR (Tesseract)
  const extractTextFromImage = async (imageFile: File) => {
    setIsExtracting(true);
    setExtractionError(null);
    try {
      const text = await runOcr(imageFile);
      if (text && text.trim()) {
        setExtractedText(text);
        await handleSummarizeWithText(text, imageFile);
      } else {
        throw new Error("No text could be extracted from this image. Ensure text is clear and readable.");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred during OCR text extraction.";
      setExtractionError(errorMessage);
      saveFailedRun(imageFile, "Image");
    } finally {
      setIsExtracting(false);
    }
  };

  const saveFailedRun = (failedFile: File, typeLabel: string) => {
    const failedItem: HistoryItem = {
      id: Math.random().toString(36).substring(2, 9),
      filename: failedFile.name,
      filetype: typeLabel,
      filesize: formatFileSize(failedFile.size),
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      extractedText: "",
      summaryData: { summary: "", keyPoints: [], improvementSuggestions: [] },
      length: "medium",
      status: "Failed"
    };
    saveToHistory(failedItem);
  };

  // Auto trigger summarization
  const handleSummarizeWithText = async (text: string, currentFile: File) => {
    if (!text.trim()) return;

    setIsSummarizing(true);
    setSummaryError(null);
    setSummaryData(null);

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          length: summaryLength,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to generate summary.");
      }

      setSummaryData(result);
      setActiveTab("summary");

      // Save to local storage history
      const fileTypeLabel = currentFile.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Image";
      const newItem: HistoryItem = {
        id: Math.random().toString(36).substring(2, 9),
        filename: currentFile.name,
        filetype: fileTypeLabel,
        filesize: formatFileSize(currentFile.size),
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        extractedText: text,
        summaryData: result,
        length: summaryLength,
        status: "Complete"
      };
      saveToHistory(newItem);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred during summarization.";
      setSummaryError(errorMessage);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setExtractedText("");
    setNumPages(null);
    setSummaryData(null);
    setExtractionError(null);
    setSummaryError(null);
    setIsSummarizing(false);
    setIsExtracting(false);
  };

  // Copy to clipboard helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  // Download markdown helper
  const downloadMarkdown = () => {
    if (!summaryData) return;

    const markdownContent = `# Document Summary Assistant Report
**Original File:** ${file?.name || "Uploaded Document"}
**Summary Length:** ${summaryLength.toUpperCase()}

## 1. Summary
${summaryData.summary}

## 2. Key Takeaways
${summaryData.keyPoints.map(point => `- ${point}`).join("\n")}

## 3. Improvements
${summaryData.improvementSuggestions.map(suggestion => `- ${suggestion}`).join("\n")}
`;

    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${file?.name?.replace(/\.[^/.]+$/, "")}_summary_report.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const wordsCount = (text: string) => {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  };

  // Load history item into workspace
  const handleOpenHistoryItem = (item: HistoryItem) => {
    if (item.status === "Failed") {
      alert("This extraction run failed. Please upload a fresh document to retry.");
      return;
    }

    const mockFile = new File([], item.filename);
    setFile(mockFile);
    setExtractedText(item.extractedText);
    setSummaryData(item.summaryData);
    setSummaryLength(item.length);
    setExtractionError(null);
    setSummaryError(null);
    setView("workspace");
    setWorkspaceMode("summary"); // default show summary tab in mobile on open
  };

  // Filter and Search History
  const filteredHistory = historyList.filter(item => {
    const matchesSearch = item.filename.toLowerCase().includes(historySearch.toLowerCase());
    const matchesType =
      historyTypeFilter === "all" ||
      item.filetype.toLowerCase() === historyTypeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  return (
    <div className={`min-h-screen flex flex-col font-sans antialiased relative transition-colors duration-300 selection:bg-[#111111] selection:text-white dark:selection:bg-white dark:selection:text-[#111111] ${
      isDarkMode ? "bg-[#191919] text-[#EEEEEE]" : "bg-[#FBFBFA] text-[#2F3437]"
    }`}>
      {/* Ambient Gradient Background Glow */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-500/5 via-transparent to-transparent opacity-30 dark:opacity-10 z-0"></div>

      {/* TopNavBar */}
      <header className={`border-b sticky top-0 z-50 transition-colors duration-300 ${
        isDarkMode ? "bg-[#202020] border-[#2C2C2C]" : "bg-white border-[#EAEAEA]"
      }`}>
        <div className="flex justify-between items-center px-4 md:px-6 h-14 w-full max-w-5xl mx-auto">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 md:gap-6">
            <button
              onClick={() => {
                setView("workspace");
                setSelectedHistoryItem(null);
              }}
              className={`font-semibold text-xs tracking-tight flex items-center gap-2 hover:opacity-90 transition-colors ${
                isDarkMode ? "text-white" : "text-[#111111]"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="hidden sm:inline">DocuSummary</span>
            </button>
            <nav className="flex items-center gap-1 md:gap-2">
              <button
                onClick={() => {
                  setView("workspace");
                  setSelectedHistoryItem(null);
                }}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                  view === "workspace"
                    ? isDarkMode ? "bg-[#2C2C2C] text-white" : "bg-[#F7F6F3] text-[#111111]"
                    : isDarkMode ? "text-[#A0A0A0] hover:text-white" : "text-[#787774] hover:text-[#111111]"
                }`}
              >
                Workspace
              </button>
              <button
                onClick={() => setView("history")}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                  view === "history"
                    ? isDarkMode ? "bg-[#2C2C2C] text-white" : "bg-[#F7F6F3] text-[#111111]"
                    : isDarkMode ? "text-[#A0A0A0] hover:text-white" : "text-[#787774] hover:text-[#111111]"
                }`}
              >
                History
              </button>
            </nav>
          </div>
          {/* Trailing Actions */}
          <div className="flex items-center gap-3 md:gap-4">
            {/* Dark Mode Slider Toggle */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-[#787774] dark:text-[#A0A0A0] uppercase tracking-wider hidden xs:inline">
                {isDarkMode ? "Dark" : "Light"}
              </span>
              <button
                onClick={toggleDarkMode}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isDarkMode ? "bg-[#2C2C2C] border-[#3C3C3C]" : "bg-[#EAEAEA]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-0.5 ${
                    isDarkMode ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            
            <input
              ref={fileInputRef}
              onChange={handleFileChange}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
            />
            <button
              onClick={triggerFileSelect}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-md shadow-none transition-all duration-200 active:scale-98 ${
                isDarkMode
                  ? "bg-[#EEEEEE] text-[#111111] hover:bg-white"
                  : "bg-[#111111] text-white hover:bg-[#222222]"
              }`}
            >
              Upload
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-grow flex flex-col w-full overflow-hidden z-10">
        {view === "history" ? (
          /* ============================================================== */
          /* RUN HISTORY VIEW                                               */
          /* ============================================================== */
          <main className="flex-grow flex flex-col md:flex-row w-full max-w-5xl mx-auto px-4 md:px-6 py-12 md:py-16 gap-6 h-[calc(100vh-56px-56px)] overflow-hidden">
            {/* Main Panel (Table) - Hidden on mobile if an item is selected */}
            <div className={`w-full md:w-[65%] border rounded-xl flex flex-col shadow-none overflow-hidden h-full transition-colors duration-300 ${
              isDarkMode ? "bg-[#202020] border-[#2C2C2C]" : "bg-white border-[#EAEAEA]"
            } ${selectedHistoryItem ? "hidden md:flex" : "flex"}`}>
              <div className={`px-4 py-3 border-b flex justify-between items-center flex-shrink-0 transition-colors duration-300 ${
                isDarkMode ? "border-[#2C2C2C] bg-[#191919]/40" : "border-[#EAEAEA] bg-[#F7F6F3]/50"
              }`}>
                <h2 className="text-xs font-bold uppercase tracking-wider">Run History</h2>
                <div className="flex gap-2">
                  <input
                    className={`px-2.5 py-1 border rounded-md text-[10px] focus:outline-none transition-all duration-200 w-28 sm:w-36 ${
                      isDarkMode
                        ? "bg-[#191919] border-[#2C2C2C] text-white focus:border-[#4C4C4C]"
                        : "bg-white border-[#EAEAEA] focus:border-[#888888] text-[#111111]"
                    }`}
                    placeholder="Search history..."
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                  <select
                    className={`border rounded-md px-2 py-1 focus:outline-none text-[10px] cursor-pointer transition-colors duration-200 ${
                      isDarkMode
                        ? "bg-[#191919] border-[#2C2C2C] text-white"
                        : "bg-white border-[#EAEAEA] text-[#2F3437]"
                    }`}
                    value={historyTypeFilter}
                    onChange={(e) => setHistoryTypeFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="pdf">PDF</option>
                    <option value="image">Image</option>
                  </select>
                </div>
              </div>
              
              <div className="flex-grow overflow-y-auto">
                {filteredHistory.length === 0 ? (
                  <div className="p-8 text-center text-[#787774] dark:text-[#A0A0A0] flex flex-col items-center justify-center h-full">
                    <svg className="w-6 h-6 text-slate-350 dark:text-slate-650 mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.008 1.24l.885 1.77a2.25 2.25 0 002.007 1.24h1.98a2.25 2.25 0 002.007-1.24l.885-1.77a2.25 2.25 0 012.007-1.24h3.86m-18 0h18" />
                    </svg>
                    <p className="text-[11px]">No records found</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className={`sticky top-0 z-10 border-b transition-colors duration-300 ${
                      isDarkMode ? "bg-[#191919] border-[#2C2C2C]" : "bg-[#F7F6F3] border-[#EAEAEA]"
                    }`}>
                      <tr className="text-[9px] text-[#787774] dark:text-[#A0A0A0] uppercase tracking-wider">
                        <th className="py-2.5 px-4 font-semibold">Name</th>
                        <th className="py-2.5 px-4 font-semibold hidden sm:table-cell">Type</th>
                        <th className="py-2.5 px-4 font-semibold hidden sm:table-cell">Date</th>
                        <th className="py-2.5 px-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y transition-colors duration-300 ${
                      isDarkMode ? "divide-[#2C2C2C] text-[#EEEEEE]" : "divide-[#EAEAEA] text-[#2F3437]"
                    }`}>
                      {filteredHistory.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedHistoryItem(item)}
                          className={`cursor-pointer transition-colors ${
                            selectedHistoryItem?.id === item.id 
                              ? isDarkMode ? "bg-[#2C2C2C]" : "bg-[#F7F6F3]"
                              : isDarkMode ? "hover:bg-[#2C2C2C]/50" : "hover:bg-[#F7F6F3]/50"
                          }`}
                        >
                          <td className={`py-3 px-4 font-medium flex items-center gap-2 transition-colors ${
                            isDarkMode ? "text-white" : "text-[#111111]"
                          }`}>
                            <svg className="w-3.5 h-3.5 text-slate-450 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            <span className="truncate max-w-[120px] sm:max-w-[200px]" title={item.filename}>
                              {item.filename}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#787774] dark:text-[#A0A0A0] hidden sm:table-cell">{item.filetype}</td>
                          <td className="py-3 px-4 text-[#787774] dark:text-[#A0A0A0] hidden sm:table-cell">{item.date}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold border ${
                                item.status === "Complete"
                                  ? isDarkMode
                                    ? "bg-emerald-950/20 border-emerald-900/30 text-emerald-400"
                                    : "bg-[#EDF3EC] border-[#D4E5D4] text-[#346538]"
                                  : isDarkMode
                                    ? "bg-rose-950/20 border-rose-900/30 text-rose-400"
                                    : "bg-[#FDEBEC] border-[#FAD2D4] text-[#9F2F2D]"
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Detail Drawer (Sidebar) - Hidden on mobile unless an item is selected */}
            <div className={`w-full md:w-[35%] border rounded-xl shadow-none flex flex-col overflow-hidden h-full transition-colors duration-300 ${
              isDarkMode ? "bg-[#202020] border-[#2C2C2C]" : "bg-white border-[#EAEAEA]"
            } ${selectedHistoryItem ? "flex" : "hidden md:flex"}`}>
              {selectedHistoryItem ? (
                <>
                  <div className={`p-4 border-b flex justify-between items-start flex-shrink-0 transition-colors duration-300 ${
                    isDarkMode ? "border-[#2C2C2C] bg-[#191919]/40" : "border-[#EAEAEA] bg-[#F7F6F3]/50"
                  }`}>
                    <div className="overflow-hidden pr-2">
                      <h4 className={`text-xs font-bold truncate transition-colors ${isDarkMode ? "text-white" : "text-[#111111]"}`} title={selectedHistoryItem.filename}>
                        {selectedHistoryItem.filename}
                      </h4>
                      <span className="text-[9px] text-[#787774] dark:text-[#A0A0A0] uppercase tracking-wider font-semibold block mt-0.5">{selectedHistoryItem.filetype} Document</span>
                    </div>
                    <button
                      onClick={() => setSelectedHistoryItem(null)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="p-4 flex-grow overflow-y-auto flex flex-col gap-4 text-[11px]">
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                        isDarkMode ? "bg-[#191919]/40 border-[#2C2C2C]" : "bg-[#F7F6F3]/50 border-[#EAEAEA]"
                      }`}>
                        <span className="text-[9px] text-[#787774] dark:text-[#A0A0A0] uppercase tracking-wider block font-semibold mb-0.5">Uploaded</span>
                        <span className={`font-semibold transition-colors ${isDarkMode ? "text-slate-200" : "text-[#111111]"}`}>{selectedHistoryItem.date}</span>
                      </div>
                      <div className={`p-3 rounded-lg border transition-colors duration-300 ${
                        isDarkMode ? "bg-[#191919]/40 border-[#2C2C2C]" : "bg-[#F7F6F3]/50 border-[#EAEAEA]"
                      }`}>
                        <span className="text-[9px] text-[#787774] dark:text-[#A0A0A0] uppercase tracking-wider block font-semibold mb-0.5">Word Count</span>
                        <span className={`font-semibold transition-colors ${isDarkMode ? "text-slate-200" : "text-[#111111]"}`}>
                          {selectedHistoryItem.extractedText ? wordsCount(selectedHistoryItem.extractedText) : 0} w
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 text-[11px]">
                      <div className={`flex justify-between py-1.5 border-b transition-colors duration-300 ${isDarkMode ? "border-[#2C2C2C]" : "border-[#EAEAEA]"}`}>
                        <span className="text-[#787774] dark:text-[#A0A0A0]">File Size</span>
                        <span className={`font-medium transition-colors ${isDarkMode ? "text-slate-200" : "text-[#111111]"}`}>{selectedHistoryItem.filesize}</span>
                      </div>
                      <div className={`flex justify-between py-1.5 border-b transition-colors duration-300 ${isDarkMode ? "border-[#2C2C2C]" : "border-[#EAEAEA]"}`}>
                        <span className="text-[#787774] dark:text-[#A0A0A0]">Status</span>
                        <span className={`font-medium transition-colors ${isDarkMode ? "text-slate-200" : "text-[#111111]"}`}>{selectedHistoryItem.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className={`p-4 border-t flex flex-col gap-2 flex-shrink-0 transition-colors duration-300 ${
                    isDarkMode ? "border-[#2C2C2C] bg-[#191919]/40" : "border-[#EAEAEA] bg-[#F7F6F3]/50"
                  }`}>
                    {selectedHistoryItem.status === "Complete" && (
                      <button
                        onClick={() => handleOpenHistoryItem(selectedHistoryItem)}
                        className={`w-full py-2 rounded-md text-[11px] font-semibold hover:opacity-90 active:scale-98 transition-all flex items-center justify-center gap-1.5 shadow-none ${
                          isDarkMode
                            ? "bg-[#EEEEEE] text-[#111111]"
                            : "bg-[#111111] text-white"
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                        Open in Workspace
                      </button>
                    )}
                    <button
                      onClick={() => deleteHistoryItem(selectedHistoryItem.id)}
                      className={`w-full bg-transparent text-rose-600 border py-2 rounded-md text-[11px] font-semibold hover:bg-rose-50/50 dark:hover:bg-rose-950/10 active:scale-98 transition-all flex items-center justify-center gap-1.5 ${
                        isDarkMode ? "border-rose-950/30" : "border-rose-100"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Delete Record
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-center text-[#787774] dark:text-[#A0A0A0] p-6 h-full">
                  <svg className="w-5 h-5 text-slate-350 dark:text-slate-650 mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.063.852l-.708 2.836a.75.75 0 001.063.852l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  <p className="text-[10px] font-medium tracking-wide uppercase">Select history run to details</p>
                </div>
              )}
            </div>
          </main>
        ) : (
          /* ============================================================== */
          /* ACTIVE WORKSPACE / DASHBOARD VIEW                              */
          /* ============================================================== */
          <div className="flex-grow flex flex-col overflow-hidden h-full z-10">
            {/* 1. LANDING/UPLOAD STATE */}
            {!file && !extractionError && (
              <main className="flex-grow flex items-center justify-center max-w-5xl mx-auto w-full px-6 py-12 md:py-24 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-16 items-center w-full">
                  {/* Left Column: Context / Features */}
                  <div className="md:col-span-6 space-y-5 sm:space-y-6 text-center md:text-left">
                    <div className={`inline-flex items-center gap-1.5 px-3 py-0.5 border rounded-full text-[9px] font-bold uppercase tracking-wider transition-colors duration-300 ${
                      isDarkMode 
                        ? "bg-[#202020] border-[#2C2C2C] text-[#8ADAFF]" 
                        : "bg-[#E1F3FE] border-[#C6E7FB] text-[#1F6C9F]"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isDarkMode ? "bg-[#8ADAFF]" : "bg-[#1F6C9F]"}`}></span>
                      Local Browser Processing
                    </div>
                    <h1 className={`text-3xl sm:text-5xl font-normal font-serif tracking-tight leading-[1.05] italic transition-colors duration-200 ${
                      isDarkMode ? "text-white" : "text-[#111111]"
                    }`}>
                      Transform reports into executive summaries.
                    </h1>
                    <p className="text-xs sm:text-sm text-[#787774] dark:text-[#A0A0A0] leading-relaxed max-w-md mx-auto md:mx-0">
                      DocuSummary uses local browser OCR to parse your files securely. Get instant, high-level summaries, key takeaways, and action items in real-time.
                    </p>
                    <div className={`space-y-3 text-[11px] sm:text-xs text-left max-w-md mx-auto md:mx-0 transition-colors duration-300 ${isDarkMode ? "text-[#EEEEEE]" : "text-[#2F3437]"}`}>
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-white" : "text-[#111111]"}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        <span><strong>100% Privacy by Design:</strong> Files never upload to external servers for text extraction.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-white" : "text-[#111111]"}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        <span><strong>Smart local OCR:</strong> Seamlessly parses both native PDFs and scanned image documents.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-white" : "text-[#111111]"}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        <span><strong>Segmented insights:</strong> Tweak lengths in real-time and export summary logs.</span>
                      </div>
                    </div>
                  </div>
                  {/* Right Column: Upload Card */}
                  <div className="md:col-span-6 w-full max-w-md mx-auto">
                    <div
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={triggerFileSelect}
                      className={`border border-dashed rounded-xl p-8 sm:p-12 flex flex-col items-center justify-center text-center transition-all duration-300 shadow-none cursor-pointer ${
                        dragActive
                          ? isDarkMode ? "border-white bg-[#202020]" : "border-[#111111] bg-[#F7F6F3]"
                          : isDarkMode ? "border-[#2C2C2C] bg-[#202020] hover:border-[#4C4C4C]" : "border-[#EAEAEA] bg-[#FFFFFF] hover:border-[#CCCCCC]"
                      }`}
                    >
                      <div className={`w-11 h-11 rounded-md border flex items-center justify-center mb-4 transition-colors duration-300 ${
                        isDarkMode ? "bg-[#191919] border-[#2C2C2C]" : "bg-[#F7F6F3] border-[#EAEAEA]"
                      }`}>
                        <svg className="w-5 h-5 text-slate-450" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </div>
                      <h3 className={`text-xs font-bold mb-1 transition-colors ${isDarkMode ? "text-white" : "text-[#111111]"}`}>Drag and drop your file</h3>
                      <p className="text-[10px] text-[#787774] dark:text-[#A0A0A0] max-w-[200px] mx-auto mb-6">
                        Supports PDF, PNG, JPG, or JPEG up to 50MB
                      </p>
                      <button className={`text-[11px] font-semibold px-4 py-2 rounded-md shadow-none transition-all duration-200 active:scale-98 ${
                        isDarkMode
                          ? "bg-[#EEEEEE] text-[#111111] hover:bg-white"
                          : "bg-[#111111] text-white hover:bg-[#222222]"
                      }`}>
                        Select Document
                      </button>
                    </div>
                  </div>
                </div>
              </main>
            )}

            {/* 2. LOADING / PROGRESSION STATUS VIEW */}
            {file && (isExtracting || isSummarizing) && (
              <main className="flex-grow flex items-center justify-center p-6">
                <div className={`w-full max-w-sm border rounded-xl p-8 shadow-none flex flex-col items-center transition-colors duration-300 ${
                  isDarkMode ? "bg-[#202020] border-[#2C2C2C]" : "bg-white border-[#EAEAEA]"
                }`}>
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center mb-4 transition-colors duration-300 ${
                    isDarkMode ? "bg-[#191919]" : "bg-[#F7F6F3]"
                  }`}>
                    <svg className={`w-4 h-4 animate-spin ${isDarkMode ? "text-white" : "text-[#111111]"}`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </div>
                  <h3 className={`text-xs font-bold mb-1 transition-colors ${isDarkMode ? "text-white" : "text-[#111111]"}`}>
                    {isOcrProcessing ? "Extracting text via OCR..." : isSummarizing ? "Analyzing text..." : "Parsing PDF document..."}
                  </h3>
                  <p className="text-[10px] text-[#787774] dark:text-[#A0A0A0] text-center font-semibold">
                    {isOcrProcessing && ocrStatus ? `${ocrStatus} (${ocrProgress}%)` : "This takes a few seconds..."}
                  </p>
                </div>
              </main>
            )}

            {/* 3. ERROR STATE VIEW */}
            {file && (extractionError || summaryError) && (
              <main className="flex-grow flex items-center justify-center p-6">
                <div className={`w-full max-w-sm border rounded-xl p-8 flex flex-col text-center shadow-none ${
                  isDarkMode ? "bg-[#202020] border-rose-900/30" : "bg-[#FDEBEC] border-[#FAD2D4]"
                }`}>
                  <div className="w-9 h-9 rounded-md bg-rose-100 dark:bg-rose-950/20 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-4 h-4 text-rose-600 dark:text-rose-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h3 className={`font-bold text-xs mb-1 transition-colors ${isDarkMode ? "text-rose-350" : "text-[#9F2F2D]"}`}>Processing Failed</h3>
                  <p className="text-[10px] text-[#787774] dark:text-[#A0A0A0] mb-5 leading-relaxed">
                    {extractionError || summaryError || "We encountered an error while parsing your document."}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={handleReset}
                      className={`border text-[11px] font-semibold px-3.5 py-1.5 rounded-md transition-all active:scale-98 shadow-none ${
                        isDarkMode
                          ? "bg-[#2C2C2C] border-[#3C3C3C] text-slate-200 hover:bg-[#3C3C3C]"
                          : "bg-white border-[#EAEAEA] text-[#2F3437] hover:bg-[#F7F6F3]"
                      }`}
                    >
                      Reset
                    </button>
                    {extractionError && (
                      <button
                        onClick={() => {
                          setExtractionError(null);
                          if (file.name.toLowerCase().endsWith(".pdf")) {
                            extractTextFromPdf(file);
                          } else {
                            extractTextFromImage(file);
                          }
                        }}
                        className={`text-[11px] font-semibold px-3.5 py-1.5 rounded-md transition-all active:scale-98 shadow-none ${
                          isDarkMode
                            ? "bg-[#EEEEEE] text-[#111111]"
                            : "bg-[#111111] text-white"
                        }`}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </main>
            )}

            {/* 4. WORKSPACE DISPLAY STATE */}
            {file && extractedText && summaryData && !isExtracting && !isSummarizing && (
              <div className="flex-grow flex flex-col overflow-hidden h-full">
                {/* Mobile Selector tabs (Only visible below md size) */}
                <div className={`flex md:hidden p-0.5 rounded-lg border mx-6 mt-4 flex-shrink-0 ${
                  isDarkMode ? "bg-[#191919] border-[#2C2C2C]" : "bg-[#F7F6F3] border-[#EAEAEA]"
                }`}>
                  <button
                    onClick={() => setWorkspaceMode("source")}
                    className={`flex-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-200 ${
                      workspaceMode === "source"
                        ? isDarkMode ? "bg-[#2C2C2C] text-white" : "bg-white text-[#111111] shadow-none"
                        : "text-[#787774] dark:text-[#A0A0A0]"
                    }`}
                  >
                    Source Text
                  </button>
                  <button
                    onClick={() => setWorkspaceMode("summary")}
                    className={`flex-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-200 ${
                      workspaceMode === "summary"
                        ? isDarkMode ? "bg-[#2C2C2C] text-white" : "bg-white text-[#111111] shadow-none"
                        : "text-[#787774] dark:text-[#A0A0A0]"
                    }`}
                  >
                    AI Summary
                  </button>
                </div>

                <main className="flex-grow flex flex-col md:flex-row w-full max-w-5xl mx-auto px-6 py-6 gap-6 h-[calc(100vh-56px-56px)] overflow-hidden">
                  {/* Left Column: Source File Viewer */}
                  <div className={`w-full md:w-1/2 flex-col h-full border rounded-xl overflow-hidden shadow-none transition-colors duration-300 ${
                    isDarkMode ? "bg-[#202020] border-[#2C2C2C]" : "bg-white border-[#EAEAEA]"
                  } ${workspaceMode === "source" ? "flex" : "hidden md:flex"}`}>
                    {/* Header */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 transition-colors duration-300 ${
                      isDarkMode ? "border-[#2C2C2C] bg-[#191919]/40" : "border-[#EAEAEA] bg-[#F7F6F3]/50"
                    }`}>
                      <div className="flex items-center gap-2 overflow-hidden pr-2">
                        {/* macOS Window Controls Chrome */}
                        <div className="flex items-center gap-1.5 mr-2">
                          <span className="w-2 h-2 rounded-full bg-slate-350 dark:bg-slate-700"></span>
                          <span className="w-2 h-2 rounded-full bg-slate-350 dark:bg-slate-700"></span>
                          <span className="w-2 h-2 rounded-full bg-slate-350 dark:bg-slate-700"></span>
                        </div>
                        <svg className="w-3.5 h-3.5 text-slate-450 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className={`text-[11px] font-semibold truncate transition-colors ${isDarkMode ? "text-white" : "text-[#111111]"}`} title={file.name}>
                          {file.name}
                        </span>
                        {numPages !== null && (
                          <span className={`font-mono text-[8px] px-1.5 py-0.5 rounded-full border transition-colors duration-300 ${
                            isDarkMode ? "bg-[#191919] border-[#2C2C2C] text-slate-400" : "bg-[#F7F6F3] border-[#EAEAEA] text-slate-500"
                          }`}>
                            {numPages}p
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleReset}
                        className="text-slate-400 hover:text-slate-650 dark:hover:text-white text-[11px] font-semibold flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Clear
                      </button>
                    </div>
                    {/* Content */}
                    <div className={`flex-grow overflow-y-auto p-4 font-mono text-[10px] leading-relaxed select-text whitespace-pre-wrap transition-colors duration-300 ${
                      isDarkMode ? "bg-[#191919]/20 text-[#A0A0A0]" : "bg-[#FBFBFA]/20 text-[#2F3437]"
                    }`}>
                      {extractedText}
                    </div>
                  </div>

                  {/* Right Column: AI Analysis Panel */}
                  <div className={`w-full md:w-1/2 flex-col h-full border rounded-xl overflow-hidden shadow-none transition-colors duration-300 ${
                    isDarkMode ? "bg-[#202020] border-[#2C2C2C]" : "bg-white border-[#EAEAEA]"
                  } ${workspaceMode === "summary" ? "flex" : "hidden md:flex"}`}>
                    {/* Header Controls */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 transition-colors duration-300 ${
                      isDarkMode ? "border-[#2C2C2C] bg-[#191919]/40" : "border-[#EAEAEA] bg-[#F7F6F3]/50"
                    }`}>
                      {/* Length Controls (Segmented) */}
                      <div className={`flex p-0.5 rounded-lg border transition-colors duration-300 ${
                        isDarkMode ? "bg-[#191919] border-[#2C2C2C]" : "bg-[#F7F6F3] border-[#EAEAEA]"
                      }`}>
                        {(["short", "medium", "long"] as const).map((len) => (
                          <button
                            key={len}
                            onClick={async () => {
                              setSummaryLength(len);
                              setIsSummarizing(true);
                              try {
                                const response = await fetch("/api/summarize", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ text: extractedText, length: len }),
                                });
                                const result = await response.json();
                                if (!response.ok) throw new Error(result.error);
                                setSummaryData(result);
                              } catch (e) {
                                setSummaryError(e instanceof Error ? e.message : "Summarization failed");
                              } finally {
                                setIsSummarizing(false);
                              }
                            }}
                            className={`px-2.5 sm:px-3 py-1 rounded-md text-[9px] sm:text-[10px] font-bold uppercase transition-all ${
                              summaryLength === len
                                ? isDarkMode 
                                  ? "bg-[#2C2C2C] text-white"
                                  : "bg-white shadow-none text-[#111111]"
                                : "text-[#787774] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-white"
                            }`}
                          >
                            {len}
                          </button>
                        ))}
                      </div>
                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <button
                          onClick={() => {
                            const content = 
                              activeTab === "summary"
                                ? summaryData.summary
                                : activeTab === "keypoints"
                                ? summaryData.keyPoints.map(p => `- ${p}`).join("\n")
                                : summaryData.improvementSuggestions.map(s => `- ${s}`).join("\n");
                            copyToClipboard(content);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-md text-[10px] sm:text-xs font-semibold shadow-none transition-all duration-200 active:scale-98 ${
                            isDarkMode
                              ? "bg-[#2C2C2C] border-[#3C3C3C] text-slate-200 hover:bg-[#3C3C3C]"
                              : "bg-white border-[#EAEAEA] text-[#2F3437] hover:bg-[#F7F6F3]"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                          </svg>
                          <span className="hidden xs:inline">Copy</span>
                        </button>
                        <button
                          onClick={downloadMarkdown}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] sm:text-xs font-semibold shadow-none transition-all duration-200 active:scale-98 ${
                            isDarkMode
                              ? "bg-[#EEEEEE] text-[#111111] hover:bg-white"
                              : "bg-[#111111] text-white hover:bg-[#222222]"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                          <span className="hidden xs:inline">Export</span>
                        </button>
                      </div>
                    </div>
                    {/* Content Area */}
                    <div className="flex-1 flex flex-col p-4 overflow-hidden bg-transparent">
                      {/* Tabs */}
                      <div className={`flex gap-4 border-b mb-4 flex-shrink-0 ${isDarkMode ? "border-[#2C2C2C]" : "border-[#EAEAEA]"}`}>
                        {(
                          [
                            { id: "summary", label: "Summary" },
                            { id: "keypoints", label: "Takeaways" },
                            { id: "suggestions", label: "Improvements" },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`text-xs font-semibold pb-2 transition-colors relative ${
                              activeTab === tab.id
                                ? isDarkMode ? "text-white font-bold" : "text-[#111111] font-bold"
                                : "text-[#787774] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-white"
                            }`}
                          >
                            {tab.label}
                            {activeTab === tab.id && (
                              <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${isDarkMode ? "bg-white" : "bg-[#111111]"}`}></div>
                            )}
                          </button>
                        ))}
                      </div>
                      {/* Summary Text Area */}
                      <div className="flex-grow overflow-y-auto text-xs leading-relaxed pr-1 select-text">
                        {activeTab === "summary" && (
                          <p className={`whitespace-pre-wrap text-[12px] leading-relaxed transition-colors duration-200 ${isDarkMode ? "text-[#EEEEEE]" : "text-[#2F3437]"}`}>
                            {summaryData.summary}
                          </p>
                        )}

                        {activeTab === "keypoints" && (
                          <ul className={`space-y-2.5 text-[12px] transition-colors duration-200 ${isDarkMode ? "text-[#EEEEEE]" : "text-[#2F3437]"}`}>
                            {summaryData.keyPoints.map((point, index) => (
                              <li key={index} className="flex gap-2">
                                <span className={`flex-shrink-0 font-bold ${isDarkMode ? "text-white" : "text-[#111111]"}`}>•</span>
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {activeTab === "suggestions" && (
                          <ul className={`space-y-2.5 text-[12px] transition-colors duration-200 ${isDarkMode ? "text-[#EEEEEE]" : "text-[#2F3437]"}`}>
                            {summaryData.improvementSuggestions.map((suggestion, index) => (
                              <li key={index} className="flex gap-2">
                                <span className={`flex-shrink-0 font-bold ${isDarkMode ? "text-white" : "text-[#111111]"}`}>•</span>
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </main>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className={`border-t mt-auto w-full flex-shrink-0 transition-colors duration-300 ${
        isDarkMode ? "bg-[#191919] border-[#2C2C2C] text-[#A0A0A0]" : "bg-[#F7F6F3] border-[#EAEAEA] text-[#787774]"
      }`}>
        <div className="flex flex-col md:flex-row justify-between items-center py-4 px-6 w-full max-w-5xl mx-auto gap-2 md:gap-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold">
            © 2026 Azim Abdulla. All rights reserved.
          </span>
          <nav className="flex gap-4 text-[10px] font-semibold">
            <span className="uppercase tracking-wider">Built for Technical Assessment</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
