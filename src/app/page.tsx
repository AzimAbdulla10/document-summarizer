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
    <div className={`min-h-screen flex flex-col font-sans antialiased transition-colors duration-200 selection:bg-slate-900 selection:text-white ${
      isDarkMode ? "bg-slate-950 text-slate-100" : "bg-[#F8FAFC] text-slate-800"
    }`}>
      {/* TopNavBar */}
      <header className={`border-b sticky top-0 z-50 transition-colors duration-200 ${
        isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200/80"
      }`}>
        <div className="flex justify-between items-center px-4 md:px-6 h-14 w-full max-w-5xl mx-auto">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 md:gap-6">
            <button
              onClick={() => {
                setView("workspace");
                setSelectedHistoryItem(null);
              }}
              className={`font-bold text-sm tracking-tight flex items-center gap-2 hover:opacity-90 transition-colors ${
                isDarkMode ? "text-white" : "text-slate-900"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
                className={`text-xs font-semibold px-2 md:px-3 py-1.5 rounded-lg transition-colors ${
                  view === "workspace"
                    ? isDarkMode ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-900"
                    : isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800/40" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                Workspace
              </button>
              <button
                onClick={() => setView("history")}
                className={`text-xs font-semibold px-2 md:px-3 py-1.5 rounded-lg transition-colors ${
                  view === "history"
                    ? isDarkMode ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-900"
                    : isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800/40" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
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
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider hidden xs:inline">
                {isDarkMode ? "Dark" : "Light"}
              </span>
              <button
                onClick={toggleDarkMode}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isDarkMode ? "bg-slate-800 border-slate-700" : "bg-slate-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isDarkMode ? "translate-x-4" : "translate-x-0"
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
              className={`text-xs font-semibold px-2.5 sm:px-3.5 py-1.5 rounded-lg shadow-sm transition-colors ${
                isDarkMode
                  ? "bg-white text-slate-950 hover:bg-slate-100"
                  : "bg-slate-950 text-white hover:bg-slate-800"
              }`}
            >
              Upload
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-grow flex flex-col w-full overflow-hidden">
        {view === "history" ? (
          /* ============================================================== */
          /* RUN HISTORY VIEW                                               */
          /* ============================================================== */
          <main className="flex-grow flex flex-col md:flex-row w-full max-w-5xl mx-auto px-4 md:px-6 py-4 md:py-6 gap-6 h-[calc(100vh-56px-56px)] overflow-hidden">
            {/* Main Panel (Table) - Hidden on mobile if an item is selected */}
            <div className={`w-full md:w-[65%] border rounded-xl flex flex-col shadow-sm overflow-hidden h-full transition-colors duration-200 ${
              isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
            } ${selectedHistoryItem ? "hidden md:flex" : "flex"}`}>
              <div className={`px-4 py-3 border-b flex justify-between items-center flex-shrink-0 transition-colors duration-200 ${
                isDarkMode ? "border-slate-800 bg-slate-950/20" : "border-slate-100 bg-slate-50/50"
              }`}>
                <h2 className="text-xs font-semibold">Run History</h2>
                <div className="flex gap-2">
                  <input
                    className={`px-2.5 py-1 border rounded-lg text-[11px] focus:outline-none transition-colors duration-200 w-28 sm:w-36 ${
                      isDarkMode
                        ? "bg-slate-950 border-slate-800 text-white focus:border-slate-700"
                        : "bg-white border-slate-200 focus:border-slate-400"
                    }`}
                    placeholder="Search history..."
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                  <select
                    className={`border rounded-lg px-2 py-1 focus:outline-none text-[11px] cursor-pointer transition-colors duration-200 ${
                      isDarkMode
                        ? "bg-slate-950 border-slate-800 text-slate-300"
                        : "bg-white border-slate-200 text-slate-700"
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
                  <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-full">
                    <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.008 1.24l.885 1.77a2.25 2.25 0 002.007 1.24h1.98a2.25 2.25 0 002.007-1.24l.885-1.77a2.25 2.25 0 012.007-1.24h3.86m-18 0h18" />
                    </svg>
                    <p className="text-xs">No records found</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className={`sticky top-0 z-10 border-b transition-colors duration-200 ${
                      isDarkMode ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"
                    }`}>
                      <tr className="text-[10px] text-slate-500 uppercase">
                        <th className="py-2.5 px-4 font-semibold">Name</th>
                        <th className="py-2.5 px-4 font-semibold hidden sm:table-cell">Type</th>
                        <th className="py-2.5 px-4 font-semibold hidden sm:table-cell">Date</th>
                        <th className="py-2.5 px-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y transition-colors duration-200 ${
                      isDarkMode ? "divide-slate-800 text-slate-300" : "divide-slate-100 text-slate-700"
                    }`}>
                      {filteredHistory.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedHistoryItem(item)}
                          className={`cursor-pointer transition-colors ${
                            selectedHistoryItem?.id === item.id 
                              ? isDarkMode ? "bg-slate-850" : "bg-slate-50"
                              : isDarkMode ? "hover:bg-slate-800/40" : "hover:bg-slate-50/40"
                          }`}
                        >
                          <td className={`py-3 px-4 font-medium flex items-center gap-2 transition-colors ${
                            isDarkMode ? "text-white" : "text-slate-900"
                          }`}>
                            <svg className="w-4 h-4 text-slate-450 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            <span className="truncate max-w-[120px] sm:max-w-[200px]" title={item.filename}>
                              {item.filename}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 hidden sm:table-cell">{item.filetype}</td>
                          <td className="py-3 px-4 text-slate-500 hidden sm:table-cell">{item.date}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${
                                item.status === "Complete"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                  : "bg-rose-50 text-rose-700 border-rose-100"
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
            <div className={`w-full md:w-[35%] border rounded-xl shadow-sm flex flex-col overflow-hidden h-full transition-colors duration-200 ${
              isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
            } ${selectedHistoryItem ? "flex" : "hidden md:flex"}`}>
              {selectedHistoryItem ? (
                <>
                  <div className={`p-4 border-b flex justify-between items-start flex-shrink-0 transition-colors duration-200 ${
                    isDarkMode ? "border-slate-800 bg-slate-950/20" : "border-slate-100 bg-slate-50/50"
                  }`}>
                    <div className="overflow-hidden pr-2">
                      <h4 className={`text-xs font-bold truncate transition-colors ${isDarkMode ? "text-white" : "text-slate-950"}`} title={selectedHistoryItem.filename}>
                        {selectedHistoryItem.filename}
                      </h4>
                      <span className="text-[10px] text-slate-400">{selectedHistoryItem.filetype} Document</span>
                    </div>
                    <button
                      onClick={() => setSelectedHistoryItem(null)}
                      className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="p-4 flex-grow overflow-y-auto flex flex-col gap-4 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-3 rounded-lg border transition-colors duration-200 ${
                        isDarkMode ? "bg-slate-950/40 border-slate-800/80" : "bg-slate-50/50 border-slate-100"
                      }`}>
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block">Uploaded</span>
                        <span className={`font-semibold transition-colors ${isDarkMode ? "text-slate-200" : "text-slate-900"}`}>{selectedHistoryItem.date}</span>
                      </div>
                      <div className={`p-3 rounded-lg border transition-colors duration-200 ${
                        isDarkMode ? "bg-slate-950/40 border-slate-800/80" : "bg-slate-50/50 border-slate-100"
                      }`}>
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block">Word Count</span>
                        <span className={`font-semibold transition-colors ${isDarkMode ? "text-slate-200" : "text-slate-900"}`}>
                          {selectedHistoryItem.extractedText ? wordsCount(selectedHistoryItem.extractedText) : 0} w
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 text-[11px]">
                      <div className={`flex justify-between py-1.5 border-b transition-colors duration-200 ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
                        <span className="text-slate-400">File Size</span>
                        <span className={`font-medium transition-colors ${isDarkMode ? "text-slate-200" : "text-slate-950"}`}>{selectedHistoryItem.filesize}</span>
                      </div>
                      <div className={`flex justify-between py-1.5 border-b transition-colors duration-200 ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
                        <span className="text-slate-400">Status</span>
                        <span className={`font-medium transition-colors ${isDarkMode ? "text-slate-200" : "text-slate-950"}`}>{selectedHistoryItem.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className={`p-4 border-t flex flex-col gap-2 flex-shrink-0 transition-colors duration-200 ${
                    isDarkMode ? "border-slate-800 bg-slate-950/20" : "border-slate-100 bg-slate-50/50"
                  }`}>
                    {selectedHistoryItem.status === "Complete" && (
                      <button
                        onClick={() => handleOpenHistoryItem(selectedHistoryItem)}
                        className={`w-full bg-slate-950 text-white py-2.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                        Open in Workspace
                      </button>
                    )}
                    <button
                      onClick={() => deleteHistoryItem(selectedHistoryItem.id)}
                      className="w-full bg-transparent text-rose-600 border border-rose-100 py-2 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Delete Record
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-center text-slate-400 p-6 h-full">
                  <svg className="w-6 h-6 text-slate-300 mb-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.063.852l-.708 2.836a.75.75 0 001.063.852l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  <p className="text-[11px]">Select a run to view specs and options.</p>
                </div>
              )}
            </div>
          </main>
        ) : (
          /* ============================================================== */
          /* ACTIVE WORKSPACE / DASHBOARD VIEW                              */
          /* ============================================================== */
          <div className="flex-grow flex flex-col overflow-hidden h-full">
            {/* 1. LANDING/UPLOAD STATE */}
            {!file && !extractionError && (
              <main className="flex-grow flex items-center justify-center max-w-5xl mx-auto w-full px-6 py-6 md:py-12 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-center w-full">
                  {/* Left Column: Context / Features */}
                  <div className="md:col-span-6 space-y-4 md:space-y-6 text-center md:text-left">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-colors duration-200 ${
                      isDarkMode ? "bg-slate-900 text-slate-300" : "bg-slate-100 text-slate-800"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isDarkMode ? "bg-white" : "bg-slate-900"}`}></span>
                      Local Browser Processing
                    </div>
                    <h1 className={`text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight transition-colors duration-200 ${
                      isDarkMode ? "text-white" : "text-slate-900"
                    }`}>
                      Transform reports into executive summaries.
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto md:mx-0">
                      DocuSummary uses local browser OCR to parse your files securely. Get instant, high-level summaries, key takeaways, and action items in real-time.
                    </p>
                    <div className={`space-y-3 text-[11px] sm:text-xs text-left max-w-md mx-auto md:mx-0 transition-colors duration-200 ${isDarkMode ? "text-slate-300" : "text-slate-650"}`}>
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-white" : "text-slate-800"}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        <span><strong>100% Privacy by Design:</strong> Files never upload to external servers for text extraction.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-white" : "text-slate-800"}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        <span><strong>Smart local OCR:</strong> Seamlessly parses both native PDFs and scanned image documents.</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDarkMode ? "text-white" : "text-slate-800"}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
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
                      className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center text-center transition-all duration-200 shadow-sm cursor-pointer ${
                        dragActive
                          ? isDarkMode ? "border-white bg-slate-900" : "border-slate-900 bg-slate-50/50"
                          : isDarkMode ? "border-slate-800 bg-slate-900 hover:border-slate-700" : "border-slate-200 bg-white hover:border-slate-350"
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-full border flex items-center justify-center mb-4 transition-colors duration-200 ${
                        isDarkMode ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-100"
                      }`}>
                        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </div>
                      <h3 className={`text-sm font-bold mb-1 transition-colors ${isDarkMode ? "text-white" : "text-slate-900"}`}>Drag and drop your file</h3>
                      <p className="text-xs text-slate-400 max-w-[200px] mx-auto mb-6">
                        Supports PDF, PNG, JPG, or JPEG up to 50MB
                      </p>
                      <button className={`text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors ${
                        isDarkMode
                          ? "bg-white text-slate-900 hover:bg-slate-100"
                          : "bg-slate-900 text-white hover:bg-slate-850"
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
                <div className={`w-full max-w-sm border rounded-xl p-8 shadow-sm flex flex-col items-center transition-colors duration-200 ${
                  isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
                }`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-4 transition-colors duration-200 ${
                    isDarkMode ? "bg-slate-950" : "bg-slate-100"
                  }`}>
                    <svg className={`w-5 h-5 animate-spin ${isDarkMode ? "text-white" : "text-slate-900"}`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </div>
                  <h3 className={`text-xs font-semibold mb-1 transition-colors ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                    {isOcrProcessing ? "Extracting text via OCR..." : isSummarizing ? "Analyzing text..." : "Parsing PDF document..."}
                  </h3>
                  <p className="text-[11px] text-slate-500 text-center">
                    {isOcrProcessing && ocrStatus ? `${ocrStatus} (${ocrProgress}%)` : "This takes a few seconds..."}
                  </p>
                </div>
              </main>
            )}

            {/* 3. ERROR STATE VIEW */}
            {file && (extractionError || summaryError) && (
              <main className="flex-grow flex items-center justify-center p-6">
                <div className={`w-full max-w-sm border rounded-xl p-8 flex flex-col text-center shadow-sm ${
                  isDarkMode ? "bg-slate-900 border-rose-900/50" : "bg-rose-50/30 border-rose-200"
                }`}>
                  <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h3 className={`font-semibold text-xs mb-1 transition-colors ${isDarkMode ? "text-white" : "text-slate-955"}`}>Processing Failed</h3>
                  <p className="text-[11px] text-slate-400 mb-5 leading-relaxed">
                    {extractionError || summaryError || "We encountered an error while parsing your document."}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={handleReset}
                      className={`border text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors shadow-sm ${
                        isDarkMode
                          ? "bg-slate-800 border-slate-700 text-slate-205 hover:bg-slate-750"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
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
                        className={`text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors shadow-sm ${
                          isDarkMode
                            ? "bg-white text-slate-950 hover:bg-slate-100"
                            : "bg-slate-950 text-white hover:bg-slate-800"
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
                <div className="flex md:hidden bg-slate-100/80 dark:bg-slate-950 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 mx-6 mt-4 flex-shrink-0">
                  <button
                    onClick={() => setWorkspaceMode("source")}
                    className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all duration-200 ${
                      workspaceMode === "source"
                        ? isDarkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    Source Text
                  </button>
                  <button
                    onClick={() => setWorkspaceMode("summary")}
                    className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all duration-200 ${
                      workspaceMode === "summary"
                        ? isDarkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    AI Summary
                  </button>
                </div>

                <main className="flex-grow flex flex-col md:flex-row w-full max-w-5xl mx-auto px-6 py-6 gap-6 h-[calc(100vh-56px-56px)] overflow-hidden">
                  {/* Left Column: Source File Viewer */}
                  <div className={`w-full md:w-1/2 flex-col h-full border rounded-xl overflow-hidden shadow-sm transition-colors duration-200 ${
                    isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
                  } ${workspaceMode === "source" ? "flex" : "hidden md:flex"}`}>
                    {/* Header */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 transition-colors duration-200 ${
                      isDarkMode ? "border-slate-800 bg-slate-950/20" : "border-slate-100 bg-slate-50/50"
                    }`}>
                      <div className="flex items-center gap-2 overflow-hidden pr-2">
                        <svg className="w-4 h-4 text-slate-450 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className={`text-xs font-semibold truncate transition-colors ${isDarkMode ? "text-white" : "text-slate-900"}`} title={file.name}>
                          {file.name}
                        </span>
                        {numPages !== null && (
                          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded-full border transition-colors duration-200 ${
                            isDarkMode ? "bg-slate-950 border-slate-800 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-500"
                          }`}>
                            {numPages}p
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleReset}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-xs font-medium flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Clear
                      </button>
                    </div>
                    {/* Content */}
                    <div className={`flex-grow overflow-y-auto p-4 font-mono text-[11px] leading-relaxed select-text whitespace-pre-wrap transition-colors duration-200 ${
                      isDarkMode ? "bg-slate-950/20 text-slate-350" : "bg-slate-50/10 text-slate-600"
                    }`}>
                      {extractedText}
                    </div>
                  </div>

                  {/* Right Column: AI Analysis Panel */}
                  <div className={`w-full md:w-1/2 flex-col h-full border rounded-xl overflow-hidden shadow-sm transition-colors duration-200 ${
                    isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
                  } ${workspaceMode === "summary" ? "flex" : "hidden md:flex"}`}>
                    {/* Header Controls */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 transition-colors duration-200 ${
                      isDarkMode ? "border-slate-800 bg-slate-950/20" : "border-slate-100 bg-slate-50/50"
                    }`}>
                      {/* Length Controls (Segmented) */}
                      <div className={`flex p-0.5 rounded-lg border transition-colors duration-200 ${
                        isDarkMode ? "bg-slate-950 border-slate-800" : "bg-slate-100 border-slate-200"
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
                            className={`px-2.5 sm:px-3 py-1 rounded-md text-[9px] sm:text-[10px] font-semibold uppercase transition-all ${
                              summaryLength === len
                                ? isDarkMode 
                                  ? "bg-slate-800 shadow-sm text-white font-bold"
                                  : "bg-white shadow-sm text-slate-900 font-bold"
                                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
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
                          className={`flex items-center gap-1 px-2 py-1.5 border rounded-lg text-[10px] sm:text-xs font-semibold shadow-sm transition-colors ${
                            isDarkMode
                              ? "bg-slate-850 border-slate-700 text-slate-205 hover:bg-slate-850"
                              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
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
                          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold shadow-sm transition-colors ${
                            isDarkMode
                              ? "bg-white text-slate-950 hover:bg-slate-100"
                              : "bg-slate-900 text-white hover:bg-slate-800"
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
                      <div className={`flex gap-4 border-b mb-4 flex-shrink-0 ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
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
                            className={`text-xs font-medium pb-2 transition-colors relative ${
                              activeTab === tab.id
                                ? isDarkMode ? "text-white font-semibold" : "text-slate-900 font-semibold"
                                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            }`}
                          >
                            {tab.label}
                            {activeTab === tab.id && (
                              <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${isDarkMode ? "bg-white" : "bg-slate-950"}`}></div>
                            )}
                          </button>
                        ))}
                      </div>
                      {/* Summary Text Area */}
                      <div className="flex-grow overflow-y-auto text-xs leading-relaxed pr-1 select-text">
                        {activeTab === "summary" && (
                          <p className={`whitespace-pre-wrap text-[12px] leading-relaxed transition-colors ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                            {summaryData.summary}
                          </p>
                        )}

                        {activeTab === "keypoints" && (
                          <ul className={`space-y-2 text-[12px] transition-colors ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                            {summaryData.keyPoints.map((point, index) => (
                              <li key={index} className="flex gap-2">
                                <span className="text-slate-400">•</span>
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {activeTab === "suggestions" && (
                          <ul className={`space-y-2 text-[12px] transition-colors ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                            {summaryData.improvementSuggestions.map((suggestion, index) => (
                              <li key={index} className="flex gap-2">
                                <span className="text-slate-400">•</span>
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
      <footer className={`border-t mt-auto w-full flex-shrink-0 transition-colors duration-200 ${
        isDarkMode ? "bg-slate-950 border-slate-900 text-slate-500" : "bg-slate-50 border-slate-200/80 text-slate-400"
      }`}>
        <div className="flex flex-col md:flex-row justify-between items-center py-4 px-6 w-full max-w-5xl mx-auto gap-2 md:gap-0">
          <span className="text-[10px] uppercase tracking-wider">
            © 2026 Azim Abdulla. All rights reserved.
          </span>
          <nav className="flex gap-4 text-[10px] font-semibold">
            <span className="text-slate-450 dark:text-slate-500">Built for Technical Assessment</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
