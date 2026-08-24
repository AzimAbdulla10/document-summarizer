# Document Summary Assistant

**Live Link:** [https://document-summarizer-tan.vercel.app/](https://document-summarizer-tan.vercel.app/)

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live%20Demo-black?logo=vercel)](https://document-summarizer-tan.vercel.app/)

A modern, production-grade Next.js application that takes PDF and image documents, extracts their text, and generates structured AI summaries, key takeaways, and improvement suggestions using the Gemini API.

## Technical Approach (Assessment Write-up)

The Document Summary Assistant is built with Next.js, TypeScript, and Tailwind CSS, prioritizing performance, privacy, and serverless reliability:

1. **Client-Side Text Extraction:**
   - **PDF Documents:** Parsed directly inside the browser using the official Mozilla `pdfjs-dist` engine loaded via CDN, extracting text layers with zero server load.
   - **Scanned Images:** Handled entirely on the client side using `tesseract.js` (WebAssembly). This prevents serverless function timeouts and body size limit errors, offloading CPU-intensive OCR to the client's browser while showing real-time progress.
2. **Robust AI Summarization:**
   - Extracted text is sent to `/api/summarize`. The endpoint makes a secure fetch call to the Gemini API (`gemini-2.5-flash` with automatic fallback to `gemini-1.5-flash` if model access differs).
   - Structured JSON mode (`responseMimeType`) ensures the AI output is parsed into distinct fields: summary, key takeaways, and writing quality improvement suggestions.
3. **Clean UX/UI:**
   - A single-page workspace featuring drag-and-drop file upload, side-by-side source/report views, summary length toggles, copy actions, and Markdown exports (download or copy).
   - Configurable via server environment variable or client-side settings (`localStorage`).

---

## Features

- 📁 **File Upload:** Supports PDF, PNG, JPG, JPEG with drag-and-drop or file picker.
- ⚙️ **Local OCR:** Full progress loading state for image OCR extraction (loading core, loading languages, parsing percentage).
- 🔍 **Split Workspace:** Compare the raw extracted text side-by-side with generated AI reports.
- 📝 **Structured AI Reports:**
  - **Summary:** Custom length control (Short, Medium, Long).
  - **Key Takeaways:** Numbered list of main points.
  - **Improvement Suggestions:** Actionable feedback on document tone, structure, and readability.
- 💾 **Export Actions:** One-click copy or markdown download of individual sections or full report.

---

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone or download the repository.
2. Install the dependencies:
   ```bash
   npm install
   ```

### Configuration

Create a `.env.local` file in the root directory:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*Note: If no environment variable is provided, you can enter and save your Gemini API key directly in the application's "API Settings" panel in the browser.*

### Running the App

Start the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

Compile and optimize the application:
```bash
npm run build
npm run start
```

---
