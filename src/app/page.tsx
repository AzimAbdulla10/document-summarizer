"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { useOcr } from "@/hooks/useOcr";

interface SummaryData {
  summary: string;
  keyPoints: string[];
  improvementSuggestions: string[];
}

export default function Home() {
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

    if (isPdf) {
      extractTextFromPdf(selectedFile);
    } else {
      extractTextFromImage(selectedFile);
    }
  };

  // PDF Text Extraction via server API
  const extractTextFromPdf = async (pdfFile: File) => {
    setIsExtracting(true);
    setExtractionError(null);
    try {
      const formData = new FormData();
      formData.append("file", pdfFile);

      const response = await fetch("/api/parse-pdf", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to extract text from PDF.");
      }

      setExtractedText(result.text);
      setNumPages(result.pages);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred while parsing the PDF.";
      setExtractionError(errorMessage);
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
      if (text) {
        setExtractedText(text);
      } else {
        throw new Error("No text could be extracted from this image.");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred during OCR text extraction.";
      setExtractionError(errorMessage);
    } finally {
      setIsExtracting(false);
    }
  };

  // Summarize via server API
  const handleSummarize = async () => {
    if (!extractedText.trim()) return;

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
          text: extractedText,
          length: summaryLength,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to generate summary.");
      }

      setSummaryData(result);
      setActiveTab("summary");
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
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

## 2. Key Points & Main Ideas
${summaryData.keyPoints.map(point => `- ${point}`).join("\n")}

## 3. Suggestions for Improvement
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

  // Text formatting preview length helper
  const wordsCount = (text: string) => {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  };

  return (
    <div className="min-h-screen bg-neutral-50/60 text-neutral-800 flex flex-col font-sans antialiased">
      {/* Navbar */}
      <header className="bg-white border-b border-neutral-200/85 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold tracking-widest bg-neutral-900 text-white px-2 py-0.5 rounded">DOCS</span>
            <span className="text-sm font-semibold tracking-tight text-neutral-900 font-sans">Document Summarizer</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-6">

        {/* Upload Zone */}
        {!file && (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileSelect}
              className={`w-full max-w-2xl border border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[360px] ${
                dragActive
                  ? "border-neutral-900 bg-neutral-50 scale-[1.005]"
                  : "border-neutral-300 bg-white hover:border-neutral-400 hover:bg-neutral-50/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf, image/*"
                onChange={handleFileChange}
              />
              
              <div className="text-neutral-400 mb-4">
                <svg className="w-8 h-8 mx-auto animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5h10.5a2.25 2.25 0 002.25-2.25V5.107c0-.29-.139-.563-.377-.736A1.5 1.5 0 0018 3.75H6c-.41 0-.75.34-.75.75v12.75c0 1.242 1.008 2.25 2.25 2.25z" />
                </svg>
              </div>

              <h2 className="text-sm font-semibold text-neutral-800 mb-1">Analyze a new document</h2>
              <p className="text-neutral-500 text-xs max-w-sm mb-6 leading-relaxed">
                Drag & drop your PDF or image scan here, or click to browse. Text extraction and OCR run locally in your browser.
              </p>

              <div className="flex gap-3 items-center justify-center flex-wrap">
                <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded bg-neutral-100 text-neutral-600 border border-neutral-200/60">
                  PDF Text Parsing
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded bg-neutral-100 text-neutral-600 border border-neutral-200/60">
                  Client-side OCR
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Extraction Error Block */}
        {extractionError && (
          <div className="bg-rose-50/50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-start gap-3 max-w-2xl mx-auto w-full">
            <svg className="w-4 h-4 flex-shrink-0 text-rose-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="font-semibold text-xs text-rose-900">Text extraction failed</h4>
              <p className="text-xs text-rose-700 mt-1 leading-relaxed">{extractionError}</p>
              <button onClick={handleReset} className="mt-3 px-3 py-1 bg-white border border-rose-300 rounded text-xs font-semibold text-rose-800 hover:bg-rose-100/50 transition-colors shadow-sm">
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Loading / Extraction state */}
        {isExtracting && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white border border-neutral-200/80 rounded-2xl p-12 max-w-xl mx-auto w-full min-h-[300px]">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative flex items-center justify-center mb-1">
                <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin"></div>
              </div>
              <h3 className="font-semibold text-xs text-neutral-800">
                {isOcrProcessing ? "Running local OCR..." : "Parsing PDF document..."}
              </h3>
              <p className="text-xs text-neutral-500 max-w-xs leading-relaxed">
                {isOcrProcessing 
                  ? `${ocrStatus || "Reading text layers with Tesseract..."} (${ocrProgress}%)`
                  : "Extracting characters and text layers..."}
              </p>
              
              {isOcrProcessing && (
                <div className="w-48 bg-neutral-100 h-1 rounded-full overflow-hidden mt-1 border border-neutral-200/50">
                  <div 
                    className="bg-neutral-800 h-full transition-all duration-300"
                    style={{ width: `${ocrProgress}%` }}
                  ></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Workspace Panels */}
        {file && !isExtracting && !extractionError && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch flex-grow min-h-[600px]">
            
            {/* Left Panel: Extracted Source Text */}
            <div className="bg-white border border-neutral-200/80 rounded-xl flex flex-col h-[600px] overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-200/60 bg-neutral-50/50 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-semibold text-xs truncate text-neutral-800" title={file.name}>{file.name}</span>
                  <span className="text-[10px] text-neutral-500 font-mono">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => copyToClipboard(extractedText)}
                    disabled={!extractedText}
                    className="text-[11px] font-semibold px-2 py-1 border border-neutral-200 rounded text-neutral-700 bg-white hover:bg-neutral-50 transition-colors disabled:opacity-50"
                  >
                    Copy
                  </button>
                  <button
                    onClick={handleReset}
                    className="text-[11px] font-semibold px-2 py-1 border border-neutral-200 rounded text-neutral-700 bg-white hover:bg-neutral-50 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Status Info */}
              <div className="bg-neutral-50/30 px-4 py-2 border-b border-neutral-200/60 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
                <span>
                  Source: <strong className="text-neutral-700 font-semibold">{file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Image Scan"}</strong>
                  {numPages !== null && ` (${numPages} page${numPages > 1 ? "s" : ""})`}
                </span>
                <span>
                  <strong>{wordsCount(extractedText)}</strong> words
                </span>
              </div>

              {/* Extracted Text Area */}
              <div className="flex-1 p-4 overflow-y-auto bg-neutral-50/10 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text text-neutral-700">
                {extractedText ? (
                  extractedText
                ) : (
                  <div className="h-full flex items-center justify-center text-neutral-400 font-sans italic text-xs">
                    No text extracted.
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: AI Summarization & Settings */}
            <div className="bg-white border border-neutral-200/80 rounded-xl flex flex-col h-[600px] overflow-hidden">
              
              {/* Length config / Generate Trigger */}
              <div className="px-4 py-3 border-b border-neutral-200/60 bg-neutral-50/50 flex items-center justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Length</span>
                  <div className="inline-flex rounded bg-neutral-100 p-0.5 border border-neutral-200/60">
                    {(["short", "medium", "long"] as const).map((len) => (
                      <button
                        key={len}
                        onClick={() => setSummaryLength(len)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-all ${
                          summaryLength === len
                            ? "bg-white text-neutral-900 shadow-sm font-bold"
                            : "text-neutral-500 hover:text-neutral-700"
                        }`}
                      >
                        {len}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleSummarize}
                  disabled={isSummarizing || !extractedText.trim()}
                  className="px-4 py-1 bg-neutral-900 hover:bg-neutral-800 text-white rounded text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {isSummarizing ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Summarizing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>Summarize</span>
                    </>
                  )}
                </button>
              </div>

              {/* Summarization Error Block */}
              {summaryError && (
                <div className="bg-rose-50 border-b border-rose-100 text-rose-800 p-3 flex items-start gap-3 flex-shrink-0">
                  <svg className="w-4 h-4 flex-shrink-0 text-rose-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h4 className="font-semibold text-xs text-rose-900">Summarization failed</h4>
                    <p className="text-xs text-rose-600 mt-0.5 leading-normal">{summaryError}</p>
                  </div>
                </div>
              )}

              {/* Summary Output Area */}
              {isSummarizing ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400">
                  <div className="w-6 h-6 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin mb-3"></div>
                  <h4 className="font-semibold text-neutral-800 text-xs mb-1">Generating summary...</h4>
                  <p className="text-[11px] text-neutral-400 text-center max-w-xs leading-relaxed">
                    Consulting Gemini model endpoint. Creating summaries, takeaways, and suggestions.
                  </p>
                </div>
              ) : summaryData ? (
                <div className="flex-grow flex flex-col overflow-hidden">
                  {/* Tabs */}
                  <div className="flex border-b border-neutral-100 bg-neutral-50/50 flex-shrink-0">
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
                        className={`flex-1 py-2.5 text-center text-xs font-semibold transition-all border-b-2 ${
                          activeTab === tab.id
                            ? "border-neutral-900 text-neutral-900 bg-white font-bold"
                            : "border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100/30"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Actions (Copy/Download) */}
                  <div className="px-4 py-2 border-b border-neutral-200/60 bg-neutral-50/20 flex items-center justify-end gap-2 flex-shrink-0">
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
                      className="text-[11px] font-semibold px-2 py-1 border border-neutral-200 bg-white hover:bg-slate-50 text-neutral-700 flex items-center gap-1 transition-colors"
                    >
                      Copy
                    </button>
                    <button
                      onClick={downloadMarkdown}
                      className="text-[11px] font-semibold px-2 py-1 bg-neutral-100 border border-neutral-200/80 text-neutral-800 hover:bg-neutral-200 flex items-center gap-1 transition-colors"
                    >
                      Export MD
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="flex-1 p-5 overflow-y-auto bg-white text-neutral-700 leading-relaxed text-xs select-text">
                    {activeTab === "summary" && (
                      <div className="space-y-4 font-sans whitespace-pre-wrap text-neutral-800 leading-relaxed">
                        {summaryData.summary}
                      </div>
                    )}

                    {activeTab === "keypoints" && (
                      <ul className="space-y-3 list-none">
                        {summaryData.keyPoints.map((point, index) => (
                          <li key={index} className="flex items-start gap-2.5">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-neutral-100 text-neutral-600 font-mono text-[9px] font-bold flex-shrink-0 mt-0.5 border border-neutral-200/50">
                              {index + 1}
                            </span>
                            <span className="text-neutral-700 leading-relaxed">{point}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {activeTab === "suggestions" && (
                      <ul className="space-y-3 list-none">
                        {summaryData.improvementSuggestions.map((suggestion, index) => (
                          <li key={index} className="flex items-start gap-2.5">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-neutral-100 text-neutral-600 font-mono text-[9px] font-bold flex-shrink-0 mt-0.5 border border-neutral-200/50">
                              {index + 1}
                            </span>
                            <span className="text-neutral-700 leading-relaxed">{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400 text-center select-none">
                  <div className="text-neutral-300 mb-3">
                    <svg className="w-6 h-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925-3.546 5.974 5.974 0 00-2.133-1.282A3.75 3.75 0 006 9.75v.008c0 .244.02.485.06.72a3.75 3.75 0 00-1.31 7.022" />
                    </svg>
                  </div>
                  <h4 className="font-semibold text-neutral-700 text-xs mb-1">Analyzer Ready</h4>
                  <p className="text-[11px] max-w-xs text-neutral-400 leading-relaxed">
                    Click <strong>Summarize</strong> above to generate structured insights.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-neutral-200/60 py-3 mt-auto">
        <div className="max-w-7xl mx-auto px-6 text-center text-[10px] text-neutral-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; 2026 Document Summarizer. Locally processed OCR &amp; Gemini intelligence.</span>
          <span className="font-medium text-neutral-500 font-sans">Confidential Technical Assessment</span>
        </div>
      </footer>
    </div>
  );
}
