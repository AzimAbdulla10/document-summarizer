import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { text, length } = await req.json();

    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: "No text content was provided for summarization." },
        { status: 400 }
      );
    }

    const requestedLength = length || "medium";
    
    // Read API key from server environment variable
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      return NextResponse.json(
        { error: "Gemini API key is not configured on the server." },
        { status: 500 }
      );
    }


    // Define the prompt based on requested length
    let lengthInstructions = "";
    if (requestedLength === "short") {
      lengthInstructions = "Write a concise summary (around 100-150 words) organized into 1 to 2 short, structured paragraphs.";
    } else if (requestedLength === "medium") {
      lengthInstructions = "Write a standard summary (around 250-300 words) structured into 2 to 3 well-formed, readable paragraphs separated by line breaks.";
    } else {
      lengthInstructions = "Write a comprehensive and detailed summary (500+ words) structured logically into 4 or more distinct paragraphs separated by line breaks.";
    }

    const systemPrompt = `You are a professional research assistant. Analyze the provided document text.
Perform the following:
1. Generate a smart summary of the document. The summary must be properly structured and divided into logical, readable paragraphs (separated by double newlines '\\n\\n') rather than a single dense block of text.
   Length requirement: ${lengthInstructions}
2. Extract the key points and main ideas as a bulleted list.
3. Suggest improvements for the document (e.g., structure, clarity, grammar, tone, or formatting).

Return the output in the requested JSON structure.`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\nDOCUMENT TEXT:\n${text}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            summary: {
              type: "STRING",
              description: "A summary of the document content matching the requested length."
            },
            keyPoints: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "List of key points and main ideas highlighted from the document."
            },
            improvementSuggestions: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Actionable recommendations on how the text's structure, grammar, readability, or tone can be improved."
            }
          },
          required: ["summary", "keyPoints", "improvementSuggestions"]
        }
      }
    };

    const candidateModels = [
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-2.5-pro"
    ];

    let response: Response | null = null;
    let lastErrorDetails: unknown = null;

    for (const modelName of candidateModels) {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
      try {
        console.log(`Attempting AI summarization with model: ${modelName}`);
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const errMsg = errorData?.error?.message || "";
          console.warn(`Model ${modelName} returned status ${res.status}: ${errMsg}`);
          
          // If the model itself is not found/supported, skip and try other models
          if (res.status === 404 || res.status === 400) {
            lastErrorDetails = errorData;
            continue;
          }
          
          // For other errors (unauthorized key, rate limits, etc.), fail immediately
          return NextResponse.json(
            { error: errMsg || `Gemini API returned error code ${res.status}` },
            { status: res.status }
          );
        }

        response = res;
        console.log(`Successfully completed summarization using model: ${modelName}`);
        break; // Working model found
      } catch (err) {
        console.error(`Fetch exception for model ${modelName}:`, err);
      }
    }

    if (!response) {
      const errorObject = lastErrorDetails as { error?: { message?: string } } | null;
      const fallbackErrorMessage = errorObject?.error?.message || "No supported Gemini models found for this API key.";
      return NextResponse.json(
        { error: fallbackErrorMessage },
        { status: 404 }
      );
    }

    const responseData = await response.json();
    const candidates = responseData?.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No response candidates returned by Gemini.");
    }

    const textResponse = candidates[0]?.content?.parts[0]?.text;
    if (!textResponse) {
      throw new Error("Empty response text from Gemini.");
    }

    // Parse the JSON string returned by Gemini
    const result = JSON.parse(textResponse.trim());
    return NextResponse.json(result);

  } catch (error: unknown) {
    console.error("AI summarization error:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred during AI summarization.";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
