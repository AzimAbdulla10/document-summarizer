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
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
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

    // Mock a file object for consistency
    const mockFile = new File([], item.filename);
    setFile(mockFile);
    setExtractedText(item.extractedText);
    setSummaryData(item.summaryData);
    setSummaryLength(item.length);
    setExtractionError(null);
    setSummaryError(null);
    setView("workspace");
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
    <div className="min-h-screen bg-[#FAFAFA] text-[#1a1c1c] flex flex-col font-sans antialiased selection:bg-[#000000] selection:text-[#ffffff]">
      {/* TopNavBar */}
      <header className="bg-[#FFFFFF] border-b border-[#E2E8F0] sticky top-0 z-50">
        <div className="flex justify-between items-center px-6 md:px-12 h-16 w-full max-w-[1280px] mx-auto">
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => {
                setView("workspace");
                setSelectedHistoryItem(null);
              }}
              className="font-sans text-lg font-bold text-[#000000] flex items-center gap-2 hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[#000000]" style={{ fontVariationSettings: "'FILL' 1" }}>
                description
              </span>
              Document Summarizer
            </button>
          </div>
          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 h-full">
            <button
              onClick={() => {
                setView("workspace");
                setSelectedHistoryItem(null);
              }}
              className={`h-full flex flex-col justify-center font-semibold text-sm transition-colors border-b-2 ${
                view === "workspace"
                  ? "text-[#000000] border-[#000000] pb-0.5"
                  : "text-[#505f76] hover:text-[#000000] border-transparent"
              }`}
            >
              Workspace
            </button>
            <button
              onClick={() => setView("history")}
              className={`h-full flex flex-col justify-center font-semibold text-sm transition-colors border-b-2 ${
                view === "history"
                  ? "text-[#000000] border-[#000000] pb-0.5"
                  : "text-[#505f76] hover:text-[#000000] border-transparent"
              }`}
            >
              History
            </button>
          </nav>
          {/* Trailing Actions */}
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              onChange={handleFileChange}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
            />
            <button
              onClick={triggerFileSelect}
              className="bg-[#000000] text-[#ffffff] font-semibold text-xs px-4 py-2 rounded-lg hover:opacity-90 transition-opacity shadow-sm"
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
          <main className="flex-grow flex w-full max-w-[1280px] mx-auto px-6 md:px-12 py-8 gap-6 h-[calc(100vh-64px)] overflow-hidden">
            {/* Main Panel (Table) */}
            <div className="w-[70%] bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] flex flex-col shadow-[0_10px_30px_rgba(0,0,0,0.04)] overflow-hidden h-full">
              <div className="p-6 border-b border-[#E2E8F0] flex justify-between items-center bg-[#FFFFFF] flex-shrink-0">
                <h1 className="font-sans text-xl font-semibold text-[#000000]">Run History</h1>
                <div className="flex gap-3">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#505f76] text-sm">
                      search
                    </span>
                    <input
                      className="pl-9 pr-4 py-1.5 border border-[#E2E8F0] rounded-lg text-xs font-semibold focus:outline-none focus:border-[#76777d] w-48 bg-[#FAFAFA]"
                      placeholder="Search history..."
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>
                  <div className="relative">
                    <select
                      className="appearance-none bg-[#FAFAFA] border border-[#E2E8F0] rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:border-[#76777d] text-xs font-semibold text-[#1a1c1c] cursor-pointer"
                      value={historyTypeFilter}
                      onChange={(e) => setHistoryTypeFilter(e.target.value)}
                    >
                      <option value="all">All Types</option>
                      <option value="pdf">PDF</option>
                      <option value="image">Image</option>
                    </select>
                    <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[#505f76] text-[16px] pointer-events-none">
                      filter_list
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex-grow overflow-y-auto">
                {filteredHistory.length === 0 ? (
                  <div className="p-12 text-center text-[#505f76]/65 flex flex-col items-center justify-center h-full">
                    <span className="material-symbols-outlined text-4xl mb-2 text-[#76777d]">folder_open</span>
                    <p className="text-sm font-semibold">No run history found.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#f9f9f9] z-10">
                      <tr>
                        <th className="py-3 px-6 text-[10px] font-bold text-[#505f76] border-b border-[#E2E8F0] uppercase tracking-wider">Document Name</th>
                        <th className="py-3 px-6 text-[10px] font-bold text-[#505f76] border-b border-[#E2E8F0] uppercase tracking-wider">Source Type</th>
                        <th className="py-3 px-6 text-[10px] font-bold text-[#505f76] border-b border-[#E2E8F0] uppercase tracking-wider">Date Uploaded</th>
                        <th className="py-3 px-6 text-[10px] font-bold text-[#505f76] border-b border-[#E2E8F0] uppercase tracking-wider">Extraction Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs divide-y divide-[#E2E8F0]">
                      {filteredHistory.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedHistoryItem(item)}
                          className={`cursor-pointer transition-colors ${
                            selectedHistoryItem?.id === item.id ? "bg-[#f9f9f9]" : "hover:bg-[#FAFAFA]"
                          }`}
                        >
                          <td className="py-4 px-6 font-semibold text-[#000000] flex items-center gap-3">
                            <span className="material-symbols-outlined text-[#76777d]">
                              {item.filetype === "PDF" ? "description" : "image"}
                            </span>
                            <span className="truncate max-w-[200px]" title={item.filename}>
                              {item.filename}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-[#45464d]">{item.filetype}</td>
                          <td className="py-4 px-6 text-[#45464d]">{item.date}</td>
                          <td className="py-4 px-6">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                item.status === "Complete"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-250"
                                  : "bg-rose-50 text-rose-700 border-rose-250"
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${item.status === "Complete" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
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

            {/* Detail Drawer (Sidebar) */}
            <div className="w-[30%] bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-[0_10px_30px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden h-full">
              {selectedHistoryItem ? (
                <>
                  <div className="p-6 border-b border-[#E2E8F0] bg-[#f9f9f9] flex justify-between items-start flex-shrink-0">
                    <div className="overflow-hidden">
                      <h2 className="text-sm font-bold text-[#000000] mb-1 break-words pr-4" title={selectedHistoryItem.filename}>
                        {selectedHistoryItem.filename}
                      </h2>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFFFFF] border border-[#E2E8F0] text-[#45464d]">
                        {selectedHistoryItem.filetype} Document
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedHistoryItem(null)}
                      className="text-[#505f76] hover:text-[#000000] p-1 rounded-full hover:bg-neutral-100 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                  <div className="p-6 flex-grow overflow-y-auto flex flex-col gap-6">
                    {/* Data Points */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#FAFAFA] p-4 rounded-xl border border-[#E2E8F0]">
                        <div className="text-[10px] font-bold text-[#505f76] mb-1 uppercase tracking-wider">Date Uploaded</div>
                        <div className="text-xs font-semibold text-[#000000]">{selectedHistoryItem.date}</div>
                      </div>
                      <div className="bg-[#FAFAFA] p-4 rounded-xl border border-[#E2E8F0]">
                        <div className="text-[10px] font-bold text-[#505f76] mb-1 uppercase tracking-wider">Word Count</div>
                        <div className="text-xs font-semibold text-[#000000]">
                          {selectedHistoryItem.extractedText ? wordsCount(selectedHistoryItem.extractedText) : 0} words
                        </div>
                      </div>
                    </div>
                    {/* Preview Thumbnail */}
                    <div className="w-full aspect-[4/3] bg-neutral-100 rounded-xl border border-[#E2E8F0] overflow-hidden relative group">
                      <div className="w-full h-full bg-[#FAFAFA] flex flex-col items-center justify-center p-6 text-center text-[#76777d]">
                        <span className="material-symbols-outlined text-4xl mb-2 font-light">find_in_page</span>
                        <p className="text-[10px] text-[#505f76]">Report generated and stored securely.</p>
                      </div>
                    </div>
                    {/* Specs */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center py-2 border-b border-[#E2E8F0]">
                        <span className="text-[11px] text-[#505f76]">File Size</span>
                        <span className="text-[11px] font-semibold text-[#000000]">{selectedHistoryItem.filesize}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b border-[#E2E8F0]">
                        <span className="text-[11px] text-[#505f76]">Report status</span>
                        <span className="text-[11px] font-semibold text-[#000000]">{selectedHistoryItem.status}</span>
                      </div>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="p-6 border-t border-[#E2E8F0] bg-[#FAFAFA] flex flex-col gap-3 flex-shrink-0">
                    {selectedHistoryItem.status === "Complete" && (
                      <button
                        onClick={() => handleOpenHistoryItem(selectedHistoryItem)}
                        className="w-full bg-[#000000] text-[#ffffff] py-2.5 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                        Open in Workspace
                      </button>
                    )}
                    <button
                      onClick={() => deleteHistoryItem(selectedHistoryItem.id)}
                      className="w-full bg-transparent text-rose-600 border border-rose-200 py-2.5 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                      Delete Record
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-center text-[#505f76]/65 p-6 h-full">
                  <span className="material-symbols-outlined text-3xl mb-2 text-[#76777d]">info</span>
                  <p className="text-xs">Select an item from run history log to view specifications and action options.</p>
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
              <main className="flex-grow flex items-center justify-center p-6">
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={triggerFileSelect}
                  className={`w-full max-w-2xl bg-[#FFFFFF] border rounded-2xl p-12 flex flex-col items-center justify-center text-center transition-all duration-300 shadow-[0_10px_30px_rgba(0,0,0,0.04)] cursor-pointer ${
                    dragActive 
                      ? "border-[#000000] bg-[#f9f9f9]" 
                      : "border-[#E2E8F0] hover:border-[#c6c6cd]"
                  }`}
                >
                  <div className="w-24 h-24 rounded-full bg-[#f3f3f3] flex items-center justify-center mb-6">
                    <span className="material-symbols-outlined text-5xl text-[#000000]">
                      description
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-[#1a1c1c] mb-2">Add your document</h2>
                  <p className="text-sm text-[#45464d] max-w-md mx-auto mb-8">
                    Drag and drop your PDF or image here, or click to browse. Text extraction and OCR happen completely locally.
                  </p>
                  <button className="bg-[#000000] text-[#ffffff] text-xs font-semibold px-8 py-3 rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2 shadow-sm">
                    Choose file
                  </button>
                  <p className="text-[11px] text-[#505f76] mt-4">
                    Supports PDF, PNG, JPG up to 50MB
                  </p>
                </div>
              </main>
            )}

            {/* 2. LOADING / PROGRESSION STATUS VIEW */}
            {file && (isExtracting || isSummarizing) && (
              <main className="flex-grow flex items-center justify-center p-6">
                <div className="w-full max-w-md bg-[#FFFFFF] border border-[#E2E8F0] rounded-2xl p-8 shadow-[0_10px_30px_rgba(0,0,0,0.04)] flex flex-col items-center">
                  
                  {/* Header / Spinner Area */}
                  <div className="flex flex-col items-center mb-10 text-center">
                    <div className="relative w-16 h-16 mb-6 flex items-center justify-center">
                      {/* Outer spinning ring */}
                      <svg className="absolute inset-0 w-full h-full text-[#E2E8F0] animate-spin" fill="none" viewBox="0 0 100 100" style={{ animationDuration: "2s" }}>
                        <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="4"></circle>
                      </svg>
                      {/* Inner spinning segment */}
                      <svg className="absolute inset-0 w-full h-full text-[#000000] animate-spin" fill="none" viewBox="0 0 100 100" style={{ animationDirection: "reverse", animationDuration: "1.5s" }}>
                        <path d="M50 4 A 46 46 0 0 1 96 50" stroke="currentColor" strokeLinecap="round" strokeWidth="4"></path>
                      </svg>
                      <span className="material-symbols-outlined text-[#000000]" style={{ fontSize: "24px" }}>
                        description
                      </span>
                    </div>
                    <h1 className="font-semibold text-sm text-[#1a1c1c] mb-2">
                      {isOcrProcessing ? "Running Image OCR..." : isSummarizing ? "Generating AI Summary..." : "Parsing PDF document..."}
                    </h1>
                    <p className="text-xs text-[#45464d]">Please wait while we extract data.</p>
                  </div>

                  {/* Progress Checklist */}
                  <div className="w-full space-y-0 border border-[#E2E8F0] rounded-lg overflow-hidden">
                    {/* Step 1: Upload Complete */}
                    <div className="flex items-start gap-4 p-4 bg-[#FFFFFF] border-b border-[#E2E8F0]">
                      <div className="flex-shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-[#10B981]" style={{ fontVariationSettings: "'FILL' 1", fontSize: "20px" }}>
                          check_circle
                        </span>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xs font-semibold text-[#1a1c1c]">Upload Complete</h3>
                      </div>
                    </div>

                    {/* Step 2: Running local OCR / Parsing */}
                    <div className={`flex items-start gap-4 p-4 border-b border-[#E2E8F0] ${isExtracting ? "bg-[#F8FAFC]" : "bg-[#FFFFFF]"}`}>
                      <div className="flex-shrink-0 mt-0.5">
                        {isExtracting ? (
                          <span className="material-symbols-outlined text-[#000000] animate-spin text-[20px]">sync</span>
                        ) : extractedText ? (
                          <span className="material-symbols-outlined text-[#10B981] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check_circle
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[#outline-variant] text-[20px]">radio_button_unchecked</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className={`text-xs font-semibold ${isExtracting ? "text-[#000000]" : "text-[#1a1c1c]"}`}>
                          {file.name.toLowerCase().endsWith(".pdf") ? "Extracting Text..." : "Running local OCR..."}
                        </h3>
                        {isExtracting && (
                          <>
                            <p className="text-[10px] text-[#45464d] mt-1 mb-2">
                              {isOcrProcessing && ocrStatus ? `${ocrStatus} (${ocrProgress}%)` : "Parsing PDF document structure..."}
                            </p>
                            <div className="w-full h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#000000] rounded-full transition-all duration-300"
                                style={{ width: `${isOcrProcessing ? ocrProgress : 70}%` }}
                              ></div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Step 3: Generating report */}
                    <div className={`flex items-start gap-4 p-4 border-b border-[#E2E8F0] ${isSummarizing ? "bg-[#F8FAFC]" : "bg-[#FFFFFF]"} ${!isSummarizing && !summaryData ? "opacity-60" : ""}`}>
                      <div className="flex-shrink-0 mt-0.5">
                        {isSummarizing ? (
                          <span className="material-symbols-outlined text-[#000000] animate-spin text-[20px]">sync</span>
                        ) : summaryData ? (
                          <span className="material-symbols-outlined text-[#10B981] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check_circle
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[#outline-variant] text-[20px]">hourglass_empty</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className={`text-xs ${isSummarizing ? "font-semibold text-[#000000]" : "text-[#45464d]"}`}>
                          Generating report...
                        </h3>
                      </div>
                    </div>

                    {/* Step 4: Finalizing insights */}
                    <div className={`flex items-start gap-4 p-4 bg-[#FFFFFF] ${!summaryData ? "opacity-40" : ""}`}>
                      <div className="flex-shrink-0 mt-0.5">
                        {summaryData ? (
                          <span className="material-symbols-outlined text-[#10B981] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check_circle
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[#outline-variant] text-[20px]">radio_button_unchecked</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xs text-[#45464d]">Finalizing insights</h3>
                      </div>
                    </div>
                  </div>
                </div>
              </main>
            )}

            {/* 3. ERROR STATE VIEW */}
            {file && (extractionError || summaryError) && (
              <main className="flex-grow flex items-center justify-center p-6">
                <div className="w-full max-w-md bg-rose-50/50 border border-rose-250 rounded-2xl p-8 flex flex-col text-center relative overflow-hidden shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
                    <span className="material-symbols-outlined text-rose-600 text-2xl font-bold">warning</span>
                  </div>
                  <h3 className="font-semibold text-sm text-[#1a1c1c] mb-1">Processing Failed</h3>
                  <p className="text-xs text-[#45464d] mb-6 max-w-xs mx-auto leading-relaxed">
                    {extractionError || summaryError || "We encountered an error while parsing your document."}
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={handleReset}
                      className="bg-[#FFFFFF] border border-[#E2E8F0] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-neutral-50 transition-colors shadow-sm"
                    >
                      Upload New
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
                        className="bg-[#000000] text-[#ffffff] text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity shadow-sm"
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
              <main className="flex-grow flex w-full max-w-[1280px] mx-auto px-6 md:px-12 py-8 gap-6 h-[calc(100vh-64px-100px)] overflow-hidden">
                
                {/* Left Column: Source File Viewer (40%) */}
                <div className="w-2/5 flex flex-col h-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.02)]">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-[#f9f9f9] flex-shrink-0">
                    <div className="flex items-center gap-3 overflow-hidden pr-2">
                      <span className="material-symbols-outlined text-[#505f76] flex-shrink-0">
                        {file.name.toLowerCase().endsWith(".pdf") ? "picture_as_pdf" : "image"}
                      </span>
                      <h2 className="text-xs font-bold text-[#000000] truncate leading-none" title={file.name}>
                        {file.name}
                      </h2>
                      <span className="bg-[#f3f3f3] text-[#505f76] font-mono text-[9px] font-bold px-2 py-0.5 rounded-full border border-[#E2E8F0] flex-shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                      {numPages !== null && (
                        <span className="bg-[#f3f3f3] text-[#505f76] font-mono text-[9px] font-bold px-2 py-0.5 rounded-full border border-[#E2E8F0] flex-shrink-0">
                          {numPages}p
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleReset}
                      className="text-[#505f76] hover:text-[#000000] text-xs font-semibold flex items-center gap-1 transition-colors flex-shrink-0"
                    >
                      <span className="material-symbols-outlined text-[16px]">refresh</span>
                      Reset
                    </button>
                  </div>
                  {/* Content */}
                  <div className="flex-grow overflow-y-auto p-6 bg-[#FAFAFA] font-mono text-[11px] leading-relaxed text-[#45464d] select-text whitespace-pre-wrap">
                    {extractedText}
                  </div>
                </div>

                {/* Right Column: AI Analysis Panel (60%) */}
                <div className="w-3/5 flex flex-col h-full bg-[#FFFFFF] border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.02)]">
                  {/* Header Controls */}
                  <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#E2E8F0] bg-[#f9f9f9] flex-shrink-0">
                    {/* Length Controls (Segmented) */}
                    <div className="flex items-center bg-[#f3f3f3] p-1 rounded-lg border border-[#E2E8F0]">
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
                          className={`px-3 py-1 rounded-md text-[10px] font-semibold uppercase transition-all ${
                            summaryLength === len
                              ? "bg-[#FFFFFF] shadow-sm text-[#000000] font-bold border border-[#E2E8F0]"
                              : "text-[#505f76] hover:text-[#000000]"
                          }`}
                        >
                          {len}
                        </button>
                      ))}
                    </div>
                    {/* Action Buttons */}
                    <div className="flex items-center gap-3">
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
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FFFFFF] text-[#000000] border border-[#E2E8F0] rounded-lg text-xs font-semibold hover:bg-neutral-50 transition-colors shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        Copy
                      </button>
                      <button
                        onClick={downloadMarkdown}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#000000] text-[#ffffff] rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">download</span>
                        Export
                      </button>
                    </div>
                  </div>
                  {/* Content Area */}
                  <div className="flex-1 flex flex-col p-6 overflow-hidden bg-[#FFFFFF]">
                    {/* Tabs */}
                    <div className="flex gap-6 border-b border-[#E2E8F0] mb-6 flex-shrink-0">
                      {(
                        [
                          { id: "summary", label: "Executive Summary" },
                          { id: "keypoints", label: "Key Takeaways" },
                          { id: "suggestions", label: "Improvements" },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`font-semibold text-xs pb-3 transition-colors relative ${
                            activeTab === tab.id
                              ? "text-[#000000] font-bold"
                              : "text-[#505f76] hover:text-[#000000]"
                          }`}
                        >
                          {tab.label}
                          {activeTab === tab.id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#000000]"></div>
                          )}
                        </button>
                      ))}
                    </div>
                    {/* Summary Text Area */}
                    <div className="flex-grow overflow-y-auto font-sans text-xs text-[#1a1c1c] leading-relaxed select-text pr-2">
                      {activeTab === "summary" && (
                        <div className="space-y-4 whitespace-pre-wrap text-[13px]">
                          {summaryData.summary}
                        </div>
                      )}

                      {activeTab === "keypoints" && (
                        <ul className="space-y-3.5 list-none text-[13px]">
                          {summaryData.keyPoints.map((point, index) => (
                            <li key={index} className="flex items-start gap-3">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-50 text-[#505f76] font-mono text-[10px] font-semibold flex-shrink-0 mt-0.5 border border-[#E2E8F0]">
                                {index + 1}
                              </span>
                              <span className="text-[#45464d] leading-relaxed">{point}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {activeTab === "suggestions" && (
                        <ul className="space-y-3.5 list-none text-[13px]">
                          {summaryData.improvementSuggestions.map((suggestion, index) => (
                            <li key={index} className="flex items-start gap-3">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-50 text-[#505f76] font-mono text-[10px] font-semibold flex-shrink-0 mt-0.5 border border-[#E2E8F0]">
                                {index + 1}
                              </span>
                              <span className="text-[#45464d] leading-relaxed">{suggestion}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </main>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-[#f3f3f3] border-t border-[#E2E8F0] mt-auto w-full flex-shrink-0">
        <div className="flex flex-col md:flex-row justify-between items-center py-6 px-12 w-full max-w-[1280px] mx-auto gap-4 md:gap-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
            © 2024 Document Summarizer. All rights reserved.
          </span>
          <nav className="flex flex-wrap justify-center md:justify-end gap-6 text-[10px] font-semibold text-[#505f76]">
            <span className="hover:underline hover:text-[#000000] cursor-pointer">Technical Assessment</span>
            <span className="hover:underline hover:text-[#000000] cursor-pointer">Built-with Credits</span>
            <span className="hover:underline hover:text-[#000000] cursor-pointer">Privacy Policy</span>
            <span className="hover:underline hover:text-[#000000] cursor-pointer">Terms of Service</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
