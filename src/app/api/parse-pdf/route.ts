import { NextRequest, NextResponse } from "next/server";
import * as pdf from "pdf-parse";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file was uploaded." },
        { status: 400 }
      );
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json(
        { error: "Uploaded file is not a PDF." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    // Resolve the constructor class dynamically from ESM namespace or default object
    const PDFParserClass = (pdf as unknown as { PDFParse?: unknown }).PDFParse || 
                           (pdf as unknown as { default?: { PDFParse?: unknown } }).default?.PDFParse;

    if (typeof PDFParserClass !== "function") {
      throw new Error("PDF parser constructor is not available.");
    }

    // Define typescript interfaces for calling the parser
    interface PDFParserInstance {
      load(): Promise<void>;
      getText(): Promise<{ text: string; total: number }>;
      getInfo(): Promise<{ info?: { Title?: string; Author?: string } }>;
    }

    const TypedParserClass = PDFParserClass as new (data: Uint8Array) => PDFParserInstance;
    const parserInstance = new TypedParserClass(new Uint8Array(arrayBuffer));
    
    await parserInstance.load();
    const parsedData = await parserInstance.getText();

    let extractedText = parsedData.text || "";
    const pageCount = parsedData.total || 1;

    let title: string | null = null;
    let author: string | null = null;
    try {
      const infoData = await parserInstance.getInfo();
      title = infoData.info?.Title || null;
      author = infoData.info?.Author || null;
    } catch {
      // Gracefully ignore metadata extraction failures
    }

    // Clean up excessive empty lines while maintaining layout
    extractedText = extractedText.replace(/\r\n/g, "\n");
    // Remove repeated spaces (preserving up to 4 spaces for formatting/columns)
    extractedText = extractedText.replace(/[ \t]{5,}/g, "    ");

    return NextResponse.json({
      text: extractedText.trim(),
      pages: pageCount,
      metadata: {
        title,
        author,
      }
    });
  } catch (error: unknown) {
    console.error("PDF parsing error:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred while parsing the PDF.";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
