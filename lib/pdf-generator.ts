import { jsPDF } from 'jspdf';
import { ResearchSession } from '@/types';
import { marked } from 'marked';

export async function generateResearchPDF(session: ResearchSession): Promise<Buffer> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let yPosition = margin;

  // jsPDF's built-in helvetica font only covers Latin. Non-Latin glyphs render
  // as spaced-out garbage, so we sanitize before drawing. But first normalize the
  // common typographic characters LLMs emit (dashes, curly quotes, non-breaking
  // spaces) to ASCII equivalents; otherwise stripping them merges adjacent text
  // (e.g. "2.5–3.75" -> "2.53.75", "long‑term" -> "longterm").
  const sanitizeForPDF = (text: string): string =>
    text
      .replace(/[‐-―−]/g, '-') // hyphens, en/em/figure dashes, minus
      .replace(/[‘’‚‛]/g, "'") // curly single quotes
      .replace(/[“”„‟]/g, '"') // curly double quotes
      .replace(/…/g, '...') // ellipsis
      .replace(/[  -   　]/g, ' ') // non-breaking / thin spaces
      .replace(/​/g, '') // zero-width space
      .replace(/[^\x00-\x7FÀ-ɏ]/g, '') // strip remaining non-Latin
      .trim();

  // Ensures room before drawing; adds a page and resets y when near the bottom.
  const ensureSpace = (needed: number = 10) => {
    if (yPosition + needed > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
    }
  };

  const addText = (text: string, fontSize: number = 10, isBold: boolean = false, indent: number = 0) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setTextColor(0, 0, 0);

    const lines = doc.splitTextToSize(sanitizeForPDF(text), maxWidth - indent);

    for (let i = 0; i < lines.length; i++) {
      ensureSpace();
      doc.text(lines[i], margin + indent, yPosition);
      yPosition += fontSize * 0.5;
    }
    yPosition += 5;
  };

  // Section heading with an accent underline rule, used for the top-level report sections.
  const addSectionHeading = (
    title: string,
    accent: [number, number, number] = [41, 128, 185]
  ) => {
    ensureSpace(16);
    addText(title, 16, true);
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition - 2, pageWidth - margin, yPosition - 2);
    yPosition += 4;
  };

  // A label: value pair on one line (bold label, normal value), wrapping the value.
  const addLabeledLine = (label: string, value: string, indent: number = 0) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    const labelText = `${label} `;
    ensureSpace();
    doc.text(labelText, margin + indent, yPosition);
    const labelWidth = doc.getTextWidth(labelText);

    doc.setFont('helvetica', 'normal');
    const valueIndent = indent + labelWidth;
    const lines = doc.splitTextToSize(sanitizeForPDF(value), maxWidth - valueIndent);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) ensureSpace();
      doc.text(lines[i], margin + valueIndent, yPosition);
      yPosition += 5;
    }
  };

  const addMarkdownText = (markdownText: string) => {
    const tokens = marked.lexer(markdownText);

    for (const token of tokens) {
      renderToken(token);
    }
  };

  const renderToken = (token: any) => {
    switch (token.type) {
      case 'heading':
        const headingSizes = [14, 13, 12, 11, 10, 10];
        const size = headingSizes[token.depth - 1] || 10;
        addText(cleanMarkdown(token.text), size, true);
        yPosition += 2;
        break;

      case 'paragraph': {
        const cleaned = cleanMarkdown(token.text);
        // Drop empty paragraphs and standalone "Sources:"/"References:" labels;
        // the model's inline source lists are stripped, and we render Web Sources separately.
        if (!cleaned.trim() || /^\s*(sources|references)\s*:?\s*$/i.test(cleaned)) {
          break;
        }
        // Some models (esp. OpenAI) emit section titles as plain paragraphs
        // instead of markdown headings. Render heading-like lines as bold.
        if (looksLikeHeading(token.text, cleaned)) {
          yPosition += 2;
          addText(cleaned, 12, true);
        } else {
          addText(cleaned, 10);
        }
        break;
      }

      case 'list':
        renderList(token);
        break;

      case 'table':
        renderTable(token);
        break;

      case 'blockquote':
        addText('  ' + cleanMarkdown(token.text), 10);
        break;

      case 'code':
        addText(token.text, 9);
        break;

      case 'space':
        yPosition += 3;
        break;

      default:
        if (token.text) {
          addText(cleanMarkdown(token.text), 10);
        }
    }
  };

  // Heuristic for a title emitted as a plain paragraph rather than a markdown heading:
  // short, bold in the source, or wrapped in **, and not ending in sentence punctuation.
  const looksLikeHeading = (raw: string, cleaned: string): boolean => {
    const trimmed = cleaned.trim();
    if (!trimmed) return false;
    const wasBold = /^\s*\*\*[^*]+\*\*\s*$/.test(raw.trim());
    const wordCount = trimmed.split(/\s+/).length;
    const endsLikeSentence = /[.:,;?!)]$/.test(trimmed);
    return wasBold || (wordCount <= 8 && !endsLikeSentence);
  };

  const renderList = (listToken: any, indentLevel: number = 0) => {
    let itemNumber = listToken.start || 1;

    for (const item of listToken.items) {
      const cleanedItem = cleanMarkdown(item.text);
      // URL-only list items (e.g. a "Sources:" list of bare links) go empty after
      // URL stripping, so skip them; sources are listed in the Web Sources section.
      if (!cleanedItem.trim()) {
        if (listToken.ordered) itemNumber++;
        continue;
      }

      const bullet = listToken.ordered ? `${itemNumber}. ` : '• ';
      const bulletWidth = doc.getTextWidth(bullet);
      const leftIndent = indentLevel * 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);

      ensureSpace();
      doc.text(bullet, margin + leftIndent, yPosition);

      const textIndent = leftIndent + bulletWidth + 2;
      const lines = doc.splitTextToSize(cleanedItem, maxWidth - textIndent);

      for (let i = 0; i < lines.length; i++) {
        if (i > 0) ensureSpace();
        doc.text(lines[i], margin + textIndent, yPosition);
        yPosition += 5;
      }

      if (item.tokens) {
        for (const subToken of item.tokens) {
          if (subToken.type === 'list') {
            renderList(subToken, indentLevel + 1);
          }
        }
      }

      if (listToken.ordered) itemNumber++;
    }
    yPosition += 2;
  };

  const renderTable = (tableToken: any) => {
    if (!tableToken.header || tableToken.header.length === 0) return;

    const numColumns = tableToken.header.length;
    const columnWidth = maxWidth / numColumns;
    const cellPadding = 2;
    const lineHeight = 4.2;

    // Draws one row, wrapping cell text over multiple lines and sizing the row
    // to the tallest cell so nothing is truncated mid-sentence.
    const drawRow = (cells: string[], isHeader: boolean = false) => {
      doc.setFontSize(isHeader ? 10 : 9);
      doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
      doc.setTextColor(0, 0, 0);

      const maxCellWidth = columnWidth - 2 * cellPadding;
      const wrapped = cells.map(c =>
        doc.splitTextToSize(cleanMarkdown(c), maxCellWidth)
      );
      const maxLines = Math.max(1, ...wrapped.map(w => w.length));
      const rowHeight = maxLines * lineHeight + 2 * cellPadding;

      ensureSpace(rowHeight);
      const startY = yPosition;

      for (let i = 0; i < numColumns; i++) {
        const x = margin + i * columnWidth;

        if (isHeader) {
          doc.setFillColor(240, 240, 240);
          doc.rect(x, startY, columnWidth, rowHeight, 'F');
        }
        doc.setDrawColor(200, 200, 200);
        doc.rect(x, startY, columnWidth, rowHeight);

        const cellLines = wrapped[i] || [];
        for (let l = 0; l < cellLines.length; l++) {
          doc.text(
            cellLines[l],
            x + cellPadding,
            startY + cellPadding + lineHeight * (l + 1) - 1
          );
        }
      }

      yPosition += rowHeight;
    };

    const headerCells = tableToken.header.map((cell: any) => cell.text);
    drawRow(headerCells, true);

    if (tableToken.rows) {
      for (const row of tableToken.rows) {
        const cells = row.map((cell: any) => cell.text);
        drawRow(cells, false);
      }
    }

    yPosition += 5;
  };

  // Sanitizes here as well since lists/tables call doc.text directly, bypassing addText
  const cleanMarkdown = (text: string): string => {
    return sanitizeForPDF(
      text
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/__/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Drop bare/parenthesized inline URLs; sources are listed cleanly in Web Sources
        .replace(/\s*\(https?:\/\/[^)]+\)/g, '')
        .replace(/https?:\/\/\S+/g, '')
        // Tidy leftover empty parens / doubled spaces / space-before-punctuation
        .replace(/\(\s*\)/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([.,;:])/g, '$1')
    );
  };

  // --- Header banner ---
  doc.setFillColor(41, 128, 185);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Deep Research Report', margin, 25);

  yPosition = 50;
  doc.setTextColor(0, 0, 0);

  // --- Research Summary ---
  addSectionHeading('Research Summary');

  addLabeledLine('Prompt:', session.initialPrompt);
  yPosition += 3;

  const createdDate = (session.createdAt as any)._seconds
    ? new Date((session.createdAt as any)._seconds * 1000)
    : new Date(session.createdAt);

  const dateString = session.userTimezone
    ? createdDate.toLocaleString('en-US', { timeZone: session.userTimezone })
    : createdDate.toLocaleString('en-US');

  addLabeledLine('Date:', dateString);
  addLabeledLine('Status:', session.status.replace(/_/g, ' ').toUpperCase());

  yPosition += 8;

  // --- Refinement Questions & Answers ---
  // (Q&A lives only here now, no longer duplicated inside the summary block.)
  if (session.refinementQuestions.length > 0) {
    addSectionHeading('Refinement Questions & Answers');
    session.refinementQuestions.forEach((q, index) => {
      addText(`${index + 1}. ${q.question}`, 11, true);
      if (q.answer) {
        addLabeledLine('Answer:', q.answer, 5);
        yPosition += 2;
      }
      yPosition += 3;
    });
    yPosition += 6;
  }

  // --- Research results ---
  if (session.openaiResult) {
    addSectionHeading('OpenAI Deep Research Results', [41, 128, 185]);
    addMarkdownText(session.openaiResult);
    yPosition += 10;
  }

  if (session.geminiResult) {
    addSectionHeading('Google Gemini Research Results', [219, 68, 55]);
    addMarkdownText(session.geminiResult);
    yPosition += 10;
  }

  // --- Web Sources ---
  if (session.webSources && session.webSources.length > 0) {
    addSectionHeading('Web Sources');

    session.webSources.forEach((source, index) => {
      ensureSpace();

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const label = `${index + 1}. `;
      doc.setTextColor(0, 0, 0);
      doc.text(label, margin, yPosition);
      const labelWidth = doc.getTextWidth(label);

      // Title only, one line, rendered as a blue underlined hyperlink (matches email style)
      const title = sanitizeForPDF(source.title) || source.url;
      const titleLine = doc.splitTextToSize(title, maxWidth - labelWidth)[0] || '';
      doc.setTextColor(17, 85, 204);
      doc.textWithLink(titleLine, margin + labelWidth, yPosition, { url: source.url });
      const titleWidth = doc.getTextWidth(titleLine);
      doc.setDrawColor(17, 85, 204);
      doc.line(margin + labelWidth, yPosition + 1, margin + labelWidth + titleWidth, yPosition + 1);

      yPosition += 7;
    });

    doc.setTextColor(0, 0, 0);
  }

  // --- Footer on every page ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
    doc.text(
      `Generated by RAG Research Assistant`,
      pageWidth / 2,
      pageHeight - 5,
      { align: 'center' }
    );
  }

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  return pdfBuffer;
}
