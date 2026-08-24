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
    <div className="min-h-screen bg-[#FAFAFA] text-slate-800 flex flex-col font-sans antialiased selection:bg-slate-900 selection:text-white">
      {/* TopNavBar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="flex justify-between items-center px-6 h-14 w-full max-w-5xl mx-auto">
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => {
                setView("workspace");
                setSelectedHistoryItem(null);
              }}
              className="font-bold text-sm text-slate-900 tracking-tight flex items-center gap-2 hover:opacity-90"
            >
              <span className="material-symbols-outlined text-slate-900 text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                description
              </span>
              DocuSummary
            </button>
            <nav className="flex items-center gap-2">
              <button
                onClick={() => {
                  setView("workspace");
                  setSelectedHistoryItem(null);
                }}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  view === "workspace"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Workspace
              </button>
              <button
                onClick={() => setView("history")}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  view === "history"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                History
              </button>
            </nav>
          </div>
          {/* Trailing Actions */}
          <div>
            <input
              ref={fileInputRef}
              onChange={handleFileChange}
              type="file"
              className="hidden"
              accept=".pdf,image/*"
            />
            <button
              onClick={triggerFileSelect}
              className="bg-slate-950 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
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
          <main className="flex-grow flex w-full max-w-5xl mx-auto px-6 py-6 gap-6 h-[calc(100vh-56px-56px)] overflow-hidden">
            {/* Main Panel (Table) */}
            <div className="w-[65%] bg-white border border-slate-200 rounded-xl flex flex-col shadow-sm overflow-hidden h-full">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center flex-shrink-0">
                <h2 className="text-xs font-semibold text-slate-900">Run History</h2>
                <div className="flex gap-2">
                  <input
                    className="px-2.5 py-1 border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:border-slate-400 bg-white w-36"
                    placeholder="Search history..."
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                  <select
                    className="bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none text-[11px] text-slate-700 cursor-pointer"
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
                    <span className="material-symbols-outlined text-2xl mb-1 text-slate-300">folder_open</span>
                    <p className="text-xs">No records found</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-200">
                      <tr className="text-[10px] text-slate-500 uppercase">
                        <th className="py-2.5 px-4 font-semibold">Name</th>
                        <th className="py-2.5 px-4 font-semibold">Type</th>
                        <th className="py-2.5 px-4 font-semibold">Date</th>
                        <th className="py-2.5 px-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                      {filteredHistory.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedHistoryItem(item)}
                          className={`cursor-pointer transition-colors ${
                            selectedHistoryItem?.id === item.id ? "bg-slate-50" : "hover:bg-slate-50/40"
                          }`}
                        >
                          <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-slate-400">
                              {item.filetype === "PDF" ? "description" : "image"}
                            </span>
                            <span className="truncate max-w-[150px]" title={item.filename}>
                              {item.filename}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500">{item.filetype}</td>
                          <td className="py-3 px-4 text-slate-500">{item.date}</td>
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

            {/* Detail Drawer (Sidebar) */}
            <div className="w-[35%] bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden h-full">
              {selectedHistoryItem ? (
                <>
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start flex-shrink-0">
                    <div className="overflow-hidden pr-2">
                      <h4 className="text-xs font-bold text-slate-950 truncate" title={selectedHistoryItem.filename}>
                        {selectedHistoryItem.filename}
                      </h4>
                      <span className="text-[10px] text-slate-500">{selectedHistoryItem.filetype} Document</span>
                    </div>
                    <button
                      onClick={() => setSelectedHistoryItem(null)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                  <div className="p-4 flex-grow overflow-y-auto flex flex-col gap-4 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block">Uploaded</span>
                        <span className="font-semibold text-slate-900">{selectedHistoryItem.date}</span>
                      </div>
                      <div className="bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider block">Word Count</span>
                        <span className="font-semibold text-slate-900">
                          {selectedHistoryItem.extractedText ? wordsCount(selectedHistoryItem.extractedText) : 0} w
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 text-[11px]">
                      <div className="flex justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">File Size</span>
                        <span className="text-slate-950 font-medium">{selectedHistoryItem.filesize}</span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Status</span>
                        <span className="text-slate-950 font-medium">{selectedHistoryItem.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col gap-2 flex-shrink-0">
                    {selectedHistoryItem.status === "Complete" && (
                      <button
                        onClick={() => handleOpenHistoryItem(selectedHistoryItem)}
                        className="w-full bg-slate-950 text-white py-2 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                        Open in Workspace
                      </button>
                    )}
                    <button
                      onClick={() => deleteHistoryItem(selectedHistoryItem.id)}
                      className="w-full bg-transparent text-rose-600 border border-rose-100 py-2 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                      Delete Record
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-center text-slate-400 p-6 h-full">
                  <span className="material-symbols-outlined text-xl mb-1 text-slate-300">info</span>
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
              <main className="flex-grow flex items-center justify-center p-6">
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={triggerFileSelect}
                  className={`w-full max-w-lg bg-white border border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${
                    dragActive
                      ? "border-slate-900 bg-slate-50/50"
                      : "border-slate-200 hover:border-slate-400 bg-white"
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-4 border border-slate-100">
                    <span className="material-symbols-outlined text-xl text-slate-500">
                      upload_file
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">Upload a document</h3>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto mb-6">
                    Drag & drop your PDF or image here, or browse. OCR parsing is fully local.
                  </p>
                  <button className="bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors shadow-sm">
                    Select File
                  </button>
                </div>
              </main>
            )}

            {/* 2. LOADING / PROGRESSION STATUS VIEW */}
            {file && (isExtracting || isSummarizing) && (
              <main className="flex-grow flex items-center justify-center p-6">
                <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-8 shadow-sm flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-slate-900 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-1">
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
                <div className="w-full max-w-sm bg-rose-50/30 border border-rose-200 rounded-xl p-8 flex flex-col text-center shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
                    <span className="material-symbols-outlined text-rose-600 text-[18px] font-bold">warning</span>
                  </div>
                  <h3 className="font-semibold text-xs text-slate-950 mb-1">Processing Failed</h3>
                  <p className="text-[11px] text-slate-500 mb-5 leading-relaxed">
                    {extractionError || summaryError || "We encountered an error while parsing your document."}
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={handleReset}
                      className="bg-white border border-slate-200 text-slate-700 text-xs font-medium px-3.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
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
                        className="bg-slate-950 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
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
              <main className="flex-grow flex w-full max-w-5xl mx-auto px-6 py-6 gap-6 h-[calc(100vh-56px-56px)] overflow-hidden">
                {/* Left Column: Source File Viewer (50%) */}
                <div className="w-1/2 flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex-shrink-0">
                    <div className="flex items-center gap-2 overflow-hidden pr-2">
                      <span className="material-symbols-outlined text-[16px] text-slate-500">
                        {file.name.toLowerCase().endsWith(".pdf") ? "picture_as_pdf" : "image"}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 truncate" title={file.name}>
                        {file.name}
                      </span>
                      {numPages !== null && (
                        <span className="bg-slate-100 text-slate-500 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-slate-200">
                          {numPages}p
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleReset}
                      className="text-slate-500 hover:text-slate-900 text-xs font-medium flex items-center gap-1 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                      Clear
                    </button>
                  </div>
                  {/* Content */}
                  <div className="flex-grow overflow-y-auto p-4 bg-slate-50/20 font-mono text-[11px] leading-relaxed text-slate-600 select-text whitespace-pre-wrap">
                    {extractedText}
                  </div>
                </div>

                {/* Right Column: AI Analysis Panel (50%) */}
                <div className="w-1/2 flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  {/* Header Controls */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex-shrink-0">
                    {/* Length Controls (Segmented) */}
                    <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
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
                              ? "bg-white shadow-sm text-slate-900 font-bold"
                              : "text-slate-500 hover:text-slate-900"
                          }`}
                        >
                          {len}
                        </button>
                      ))}
                    </div>
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
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
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors rounded-lg text-xs font-semibold shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        Copy
                      </button>
                      <button
                        onClick={downloadMarkdown}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white hover:bg-slate-800 transition-colors rounded-lg text-xs font-semibold shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[16px]">download</span>
                        Export
                      </button>
                    </div>
                  </div>
                  {/* Content Area */}
                  <div className="flex-1 flex flex-col p-4 overflow-hidden bg-white">
                    {/* Tabs */}
                    <div className="flex gap-4 border-b border-slate-100 mb-4 flex-shrink-0">
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
                              ? "text-slate-900 font-semibold"
                              : "text-slate-500 hover:text-slate-900"
                          }`}
                        >
                          {tab.label}
                          {activeTab === tab.id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-950"></div>
                          )}
                        </button>
                      ))}
                    </div>
                    {/* Summary Text Area */}
                    <div className="flex-grow overflow-y-auto text-xs text-slate-800 leading-relaxed pr-1 select-text">
                      {activeTab === "summary" && (
                        <p className="whitespace-pre-wrap text-[12px] text-slate-700 leading-relaxed">
                          {summaryData.summary}
                        </p>
                      )}

                      {activeTab === "keypoints" && (
                        <ul className="space-y-2 text-[12px] text-slate-700">
                          {summaryData.keyPoints.map((point, index) => (
                            <li key={index} className="flex gap-2">
                              <span className="text-slate-400">•</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {activeTab === "suggestions" && (
                        <ul className="space-y-2 text-[12px] text-slate-700">
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
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 mt-auto w-full flex-shrink-0">
        <div className="flex flex-col md:flex-row justify-between items-center py-4 px-6 w-full max-w-5xl mx-auto gap-2 md:gap-0">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">
            © 2024 Document Summarizer. All rights reserved.
          </span>
          <nav className="flex gap-4 text-[10px] font-semibold text-slate-400">
            <span className="hover:text-slate-600 cursor-pointer">Technical Assessment</span>
            <span className="hover:text-slate-600 cursor-pointer">Privacy Policy</span>
            <span className="hover:text-slate-600 cursor-pointer">Terms of Service</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
