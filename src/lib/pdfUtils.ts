import * as pdfjsLib from 'pdfjs-dist';

export interface PdfExtraction {
  text: string;
  pagesTotal: number;
  pagesWithText: number;
}

/**
 * Extract selectable text from a PDF and report coverage.
 * No CDN worker / cmap fetch — runs on the main thread so a 2G link does
 * not have to download pdf.worker from unpkg before the first page.
 *
 * Scanned (image-only) pages count toward pagesTotal but not pagesWithText.
 */
export async function extractPdfEvidence(file: File): Promise<PdfExtraction> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  } as any).promise;

  const pagesTotal = pdf.numPages || 0;
  let pagesWithText = 0;
  const parts: string[] = [];

  for (let i = 1; i <= pagesTotal; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items || [])
      .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (strings.length > 0) pagesWithText += 1;
    parts.push(strings);
  }

  return {
    text: parts.join('\n'),
    pagesTotal,
    pagesWithText,
  };
}

/** Back-compat wrapper — prefer extractPdfEvidence so coverage is not discarded. */
export async function extractTextFromPDF(file: File): Promise<string> {
  const result = await extractPdfEvidence(file);
  return result.text;
}
