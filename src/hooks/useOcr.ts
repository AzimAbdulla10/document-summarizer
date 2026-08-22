import { useState, useCallback } from "react";
import { createWorker } from "tesseract.js";

export function useOcr() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const runOcr = useCallback(async (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    setStatus("Initializing OCR engine...");
    setError(null);
    setText("");

    let worker: unknown = null;
    try {
      const tesseractWorker = await createWorker("eng", 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 100));
            setStatus("Extracting text from image...");
          } else {
            if (m.status === "loading tesseract core") {
              setStatus("Loading OCR core module...");
            } else if (m.status === "initializing api") {
              setStatus("Initializing language API...");
            } else if (m.status === "loading language traineddata") {
              setStatus("Loading trained language models...");
            } else {
              setStatus(`${m.status.charAt(0).toUpperCase() + m.status.slice(1)}...`);
            }
          }
        },
      });
      worker = tesseractWorker;

      const { data } = await tesseractWorker.recognize(file);
      setText(data.text);
      setProgress(100);
      setStatus("Completed successfully");
      return data.text;
    } catch (err: unknown) {
      console.error("OCR error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to extract text from the image.";
      setError(errorMessage);
      setStatus("Error occurred during OCR");
      return null;
    } finally {
      if (worker) {
        try {
          await (worker as { terminate: () => Promise<unknown> }).terminate();
        } catch (e) {
          console.error("Failed to terminate worker:", e);
        }
      }
      setIsProcessing(false);
    }
  }, []);

  return {
    runOcr,
    isProcessing,
    progress,
    status,
    text,
    error,
  };
}
