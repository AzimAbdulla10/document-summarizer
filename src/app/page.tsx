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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-md">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Document Summary Assistant</h1>
              <p className="text-xs text-slate-500">PDF Text Extraction, OCR, & Smart AI Reports</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">

        {/* Upload Zone */}
        {!file && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileSelect}
              className={`w-full max-w-3xl border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[400px] ${
                dragActive
                  ? "border-indigo-600 bg-indigo-50/50 shadow-inner scale-[1.01]"
                  : "border-slate-300 bg-white hover:border-indigo-500 hover:shadow-md"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf, image/*"
                onChange={handleFileChange}
              />
              
              <div className="bg-indigo-50 text-indigo-600 p-6 rounded-2xl mb-6 shadow-sm border border-indigo-100/50">
                <svg className="w-10 h-10 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>

              <h2 className="text-xl font-bold text-slate-800 mb-2">Upload your document</h2>
              <p className="text-slate-500 text-sm max-w-md mb-6">
                Drag and drop your document file here, or click to browse. Supports PDF documents and image scans (PNG, JPG, JPEG).
              </p>

              <div className="flex gap-4 items-center justify-center flex-wrap">
                <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  PDF Document Parsing
                </span>
                <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Tesseract Image OCR
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Extraction Error Block */}
        {extractionError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 flex-shrink-0 text-rose-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="font-bold text-sm">Extraction Failed</h4>
              <p className="text-xs text-rose-600 mt-1">{extractionError}</p>
              <button onClick={handleReset} className="mt-3 px-3 py-1 bg-white border border-rose-200 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors shadow-sm">
                Try Another File
              </button>
            </div>
          </div>
        )}

        {/* Loading / Extraction state */}
        {isExtracting && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white border border-slate-200 rounded-3xl p-12 max-w-3xl mx-auto w-full min-h-[400px]">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                {isOcrProcessing && (
                  <div className="absolute text-xs font-semibold text-indigo-700 font-mono">
                    {ocrProgress}%
                  </div>
                )}
              </div>
              <h3 className="font-bold text-lg text-slate-800">
                {isOcrProcessing ? "Running Image OCR..." : "Parsing PDF Document..."}
              </h3>
              <p className="text-sm text-slate-500 max-w-md">
                {isOcrProcessing 
                  ? `${ocrStatus || "Reading image content locally using Tesseract.js..."}`
                  : "Extracting text formatting and characters on the server..."}
              </p>
              
              {isOcrProcessing && (
                <div className="w-64 bg-slate-100 h-2 rounded-full overflow-hidden mt-2 border border-slate-200">
                  <div 
                    className="bg-indigo-600 h-full transition-all duration-300"
                    style={{ width: `${ocrProgress}%` }}
                  ></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Workspace Panels */}
        {file && !isExtracting && !extractionError && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch flex-1">
            
            {/* Left Panel: Extracted Source Text */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col h-[650px] overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                  </div>
                  <span className="font-bold text-sm truncate text-slate-800">{file.name}</span>
                  <span className="text-xs text-slate-500 font-medium">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyToClipboard(extractedText)}
                    disabled={!extractedText}
                    className="text-xs font-semibold px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    Copy Text
                  </button>
                  <button
                    onClick={handleReset}
                    className="text-xs font-semibold px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Status Info */}
              <div className="bg-indigo-50/30 px-5 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Source type: <strong className="text-indigo-700">{file.type === "application/pdf" ? "PDF" : "Image Scan"}</strong>
                  {numPages !== null && ` (${numPages} page${numPages > 1 ? "s" : ""})`}
                </span>
                <span>
                  <strong>{wordsCount(extractedText)}</strong> words extracted
                </span>
              </div>

              {/* Extracted Text Area */}
              <div className="flex-1 p-5 overflow-y-auto bg-slate-50/20 font-mono text-sm leading-relaxed whitespace-pre-wrap select-text">
                {extractedText ? (
                  extractedText
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 font-sans italic text-xs">
                    No text extracted. Click reset and try uploading again.
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: AI Summarization & Settings */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col h-[650px] overflow-hidden">
              
              {/* Length config / Generate Trigger */}
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Length:</span>
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                    {(["short", "medium", "long"] as const).map((len) => (
                      <button
                        key={len}
                        onClick={() => setSummaryLength(len)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition-all ${
                          summaryLength === len
                            ? "bg-white text-indigo-600 shadow-sm"
                            : "text-slate-600 hover:text-slate-800"
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
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  {isSummarizing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                      </svg>
                      <span>Generate AI Summary</span>
                    </>
                  )}
                </button>
              </div>

              {/* Summarization Error Block */}
              {summaryError && (
                <div className="bg-rose-50 border-b border-rose-100 text-rose-800 p-4 flex items-start gap-3 flex-shrink-0">
                  <svg className="w-5 h-5 flex-shrink-0 text-rose-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h4 className="font-bold text-xs">Summarization Failed</h4>
                    <p className="text-xxs text-rose-600 mt-0.5 leading-normal">{summaryError}</p>
                  </div>
                </div>
              )}

              {/* Summary Output Area */}
              {isSummarizing ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500">
                  <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                  <h4 className="font-bold text-slate-800 text-sm mb-1">Generating Structured Report</h4>
                  <p className="text-xs text-slate-500 text-center max-w-xs">
                    Gemini is parsing the text structure, drafting a summary, extracting key takeaways, and preparing style recommendations...
                  </p>
                </div>
              ) : summaryData ? (
                <div className="flex-grow flex flex-col overflow-hidden">
                  {/* Tabs */}
                  <div className="flex border-b border-slate-100 bg-slate-50 flex-shrink-0">
                    {(
                      [
                        { id: "summary", label: "Summary" },
                        { id: "keypoints", label: "Key Takeaways" },
                        { id: "suggestions", label: "Improvement Suggestions" },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-3 text-center text-xs font-bold transition-all border-b-2 ${
                          activeTab === tab.id
                            ? "border-indigo-600 text-indigo-600 bg-white"
                            : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Actions (Copy/Download) */}
                  <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/30 flex items-center justify-end gap-2 flex-shrink-0">
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
                      className="text-xs font-semibold px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy Section
                    </button>
                    <button
                      onClick={downloadMarkdown}
                      className="text-xs font-semibold px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 flex items-center gap-1 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download MD Report
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="flex-1 p-6 overflow-y-auto bg-slate-50/20 text-slate-800 leading-relaxed text-sm select-text">
                    {activeTab === "summary" && (
                      <div className="space-y-4 font-sans whitespace-pre-wrap">
                        {summaryData.summary}
                      </div>
                    )}

                    {activeTab === "keypoints" && (
                      <ul className="space-y-3 list-none">
                        {summaryData.keyPoints.map((point, index) => (
                          <li key={index} className="flex items-start gap-2.5">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 font-bold text-xs flex-shrink-0 mt-0.5 border border-indigo-100">
                              {index + 1}
                            </span>
                            <span className="text-slate-700 leading-normal">{point}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {activeTab === "suggestions" && (
                      <ul className="space-y-3 list-none">
                        {summaryData.improvementSuggestions.map((suggestion, index) => (
                          <li key={index} className="flex items-start gap-2.5">
                            <span className="inline-flex items-center justify-center p-1 rounded-md bg-amber-50 text-amber-600 flex-shrink-0 mt-0.5 border border-amber-100">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                            </span>
                            <span className="text-slate-700 leading-normal">{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400 text-center select-none">
                  <div className="bg-slate-50 text-slate-400 p-4 rounded-full border border-slate-100 mb-4">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h4 className="font-semibold text-slate-700 text-sm mb-1">AI Workbench Ready</h4>
                  <p className="text-xs max-w-xs text-slate-500">
                    Once text extraction is complete, select a summary length and click <strong>Generate AI Summary</strong> above to start analyzing.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>&copy; 2026 Document Summary Assistant. Built with Next.js, Tesseract.js & Gemini.</span>
          <span className="font-semibold text-slate-600">Confidential Technical Assessment</span>
        </div>
      </footer>
    </div>
  );
}
