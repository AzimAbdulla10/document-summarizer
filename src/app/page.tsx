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
    <div className="min-h-screen bg-slate-50/50 text-slate-800 flex flex-col font-sans antialiased">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg className="w-4.5 h-4.5 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="text-sm font-semibold tracking-tight text-slate-900 font-sans">Document Summarizer</span>
          </div>
          <div className="text-[10px] text-slate-400 font-medium font-mono">v1.0</div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex flex-col gap-6">

        {/* Upload Zone */}
        {!file && (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileSelect}
              className={`w-full max-w-xl bg-white border rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,0.01),0_12px_28px_rgba(0,0,0,0.02)] hover:shadow-[0_1px_3px_rgba(0,0,0,0.01),0_16px_36px_rgba(0,0,0,0.04)] hover:border-slate-350 flex flex-col items-center justify-center min-h-[340px] group ${
                dragActive ? "border-slate-900 border-solid bg-slate-50/50" : "border-slate-200/80 border-dashed"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf, image/*"
                onChange={handleFileChange}
              />
              
              <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>

              <h2 className="text-sm font-semibold text-slate-900 mb-1">Add your document</h2>
              <p className="text-slate-500 text-xs max-w-xs mb-6 leading-relaxed">
                Drag and drop your PDF or image here, or click to browse. Text extraction and OCR happen completely locally.
              </p>

              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-800 bg-slate-50 px-3.5 py-1.5 rounded-lg border border-slate-150 transition-colors hover:bg-slate-100">
                Choose file
              </div>
            </div>
          </div>
        )}

        {/* Extraction Error Block */}
        {extractionError && (
          <div className="bg-rose-50/50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-start gap-3 max-w-xl mx-auto w-full">
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
          <div className="flex-1 flex flex-col items-center justify-center bg-white border border-slate-200/80 rounded-2xl p-12 max-w-xl mx-auto w-full min-h-[300px] shadow-[0_1px_3px_rgba(0,0,0,0.01),0_12px_28px_rgba(0,0,0,0.02)] animate-pulse">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative flex items-center justify-center mb-1">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
              </div>
              <h3 className="font-semibold text-xs text-slate-800">
                {isOcrProcessing ? "Running local OCR..." : "Parsing PDF document..."}
              </h3>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                {isOcrProcessing 
                  ? `${ocrStatus || "Reading text layers with Tesseract..."} (${ocrProgress}%)`
                  : "Extracting characters and text layers..."}
              </p>
              
              {isOcrProcessing && (
                <div className="w-48 bg-slate-100 h-1 rounded-full overflow-hidden mt-1 border border-slate-200/50">
                  <div 
                    className="bg-slate-800 h-full transition-all duration-300"
                    style={{ width: `${ocrProgress}%` }}
                  ></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Workspace Panels */}
        {file && !isExtracting && !extractionError && (
          <div className="flex-1 bg-white border border-slate-200/80 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.01),0_12px_28px_rgba(0,0,0,0.02)] grid grid-cols-1 lg:grid-cols-12 overflow-hidden h-[620px]">
            
            {/* Left Panel: Extracted Source Text (5 cols) */}
            <div className="lg:col-span-5 flex flex-col border-r border-slate-100 h-full">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-slate-50/20">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-semibold text-xs truncate text-slate-800" title={file.name}>{file.name}</span>
                  <span className="text-[10px] text-slate-400 font-mono font-medium bg-slate-50 px-1.5 py-0.5 rounded border border-slate-150 flex-shrink-0">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button
                  onClick={handleReset}
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-wider"
                >
                  Reset
                </button>
              </div>

              {/* Status Info */}
              <div className="bg-slate-50/40 px-5 py-2 border-b border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>
                  Source: <strong className="text-slate-600 font-semibold">{file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Image"}</strong>
                  {numPages !== null && ` (${numPages}p)`}
                </span>
                <span>
                  <strong>{wordsCount(extractedText)}</strong> words
                </span>
              </div>

              {/* Extracted Text Area */}
              <div className="flex-1 p-5 overflow-y-auto bg-slate-50/10 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text text-slate-600">
                {extractedText ? (
                  extractedText
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 font-sans italic text-xs">
                    No text extracted.
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: AI Summarization & Settings (7 cols) */}
            <div className="lg:col-span-7 flex flex-col h-full bg-slate-50/10">
              
              {/* Length config / Generate Trigger */}
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-shrink-0 bg-white">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Length</span>
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/50">
                    {(["short", "medium", "long"] as const).map((len) => (
                      <button
                        key={len}
                        onClick={() => setSummaryLength(len)}
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-semibold uppercase transition-all duration-200 ${
                          summaryLength === len
                            ? "bg-white text-slate-900 shadow-sm font-bold"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {len}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  {summaryData && (
                    <>
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
                        className="text-[11px] font-semibold px-2.5 py-1 border border-slate-200 rounded-md text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                      >
                        Copy
                      </button>
                      <button
                        onClick={downloadMarkdown}
                        className="text-[11px] font-semibold px-2.5 py-1 border border-slate-200 rounded-md text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                      >
                        Export
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleSummarize}
                    disabled={isSummarizing || !extractedText.trim()}
                    className="px-3.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    {isSummarizing ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>Summarizing...</span>
                      </>
                    ) : (
                      <span>Summarize</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Summarization Error Block */}
              {summaryError && (
                <div className="bg-rose-50 border-b border-rose-100 text-rose-800 p-3.5 flex items-start gap-3 flex-shrink-0">
                  <svg className="w-4 h-4 flex-shrink-0 text-rose-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="text-xs">
                    <h4 className="font-semibold text-rose-900">Summarization failed</h4>
                    <p className="text-rose-600 mt-0.5 leading-normal">{summaryError}</p>
                  </div>
                </div>
              )}

              {/* Summary Output Area */}
              {isSummarizing ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400 bg-white">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin mb-3"></div>
                  <h4 className="font-semibold text-slate-800 text-xs mb-1">Generating report...</h4>
                  <p className="text-[11px] text-slate-400 text-center max-w-xs leading-relaxed">
                    Analyzing key structural components and distilling insights.
                  </p>
                </div>
              ) : summaryData ? (
                <div className="flex-grow flex flex-col overflow-hidden bg-white">
                  {/* Tabs */}
                  <div className="flex border-b border-slate-100 bg-white flex-shrink-0 px-2 gap-1">
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
                        className={`py-3 px-3 text-xs font-medium transition-all relative ${
                          activeTab === tab.id
                            ? "text-slate-950 font-semibold"
                            : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {tab.label}
                        {activeTab === tab.id && (
                          <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-slate-900 rounded-full"></div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Tab Contents */}
                  <div className="flex-grow p-6 overflow-y-auto bg-white text-slate-750 leading-relaxed text-xs select-text">
                    {activeTab === "summary" && (
                      <div className="space-y-4 font-sans whitespace-pre-wrap text-slate-850 leading-relaxed text-[12.5px]">
                        {summaryData.summary}
                      </div>
                    )}

                    {activeTab === "keypoints" && (
                      <ul className="space-y-3.5 list-none text-[12.5px]">
                        {summaryData.keyPoints.map((point, index) => (
                          <li key={index} className="flex items-start gap-3">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-50 text-slate-500 font-mono text-[10px] font-semibold flex-shrink-0 mt-0.5 border border-slate-150">
                              {index + 1}
                            </span>
                            <span className="text-slate-700 leading-relaxed">{point}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {activeTab === "suggestions" && (
                      <ul className="space-y-3.5 list-none text-[12.5px]">
                        {summaryData.improvementSuggestions.map((suggestion, index) => (
                          <li key={index} className="flex items-start gap-3">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-50 text-slate-500 font-mono text-[10px] font-semibold flex-shrink-0 mt-0.5 border border-slate-150">
                              {index + 1}
                            </span>
                            <span className="text-slate-700 leading-relaxed">{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center p-8 text-slate-400 text-center select-none bg-white">
                  <h4 className="font-semibold text-slate-700 text-xs mb-1">Summarizer Ready</h4>
                  <p className="text-[11px] max-w-xs text-slate-400 leading-relaxed">
                    Generate structured summaries and suggestions by clicking <strong>Summarize</strong> above.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200/60 py-3 mt-auto">
        <div className="max-w-6xl mx-auto px-6 text-center text-[10px] text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; 2026 Document Summarizer. Locally processed OCR &amp; Gemini intelligence.</span>
          <span className="font-medium text-slate-500 font-sans">Confidential Technical Assessment</span>
        </div>
      </footer>
    </div>
  );
}
