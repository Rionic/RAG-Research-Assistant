import sgMail from '@sendgrid/mail';
import { ResearchSession } from '@/types';
import { generateResearchPDF } from './pdf-generator';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendResearchReport(session: ResearchSession): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('SendGrid API key is not configured');
  }

  if (!process.env.SENDGRID_FROM_EMAIL) {
    throw new Error('SendGrid from email is not configured');
  }

  const pdfBuffer = await generateResearchPDF(session);
  const summary = generateEmailSummary(session);

  const msg = {
    to: session.userEmail,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: process.env.SENDGRID_FROM_NAME || 'Research Assistant',
    },
    subject: `Your Research Report: ${session.initialPrompt.substring(0, 50)}${session.initialPrompt.length > 50 ? '...' : ''}`,
    text: summary,
    html: generateEmailHTML(session, summary),
    attachments: [
      {
        content: pdfBuffer.toString('base64'),
        filename: `research-report-${session.id}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      },
    ],
  };

  await sgMail.send(msg);
}

function generateEmailSummary(session: ResearchSession): string {
  let summary = `Research Report\n\n`;
  summary += `Initial Prompt: ${session.initialPrompt}\n\n`;

  if (session.refinementQuestions.length > 0) {
    summary += `Refinement Questions:\n`;
    session.refinementQuestions.forEach((q, index) => {
      summary += `${index + 1}. ${q.question}\n`;
      if (q.answer) {
        summary += `   Answer: ${q.answer}\n`;
      }
    });
    summary += '\n';
  }

  const completedDate = session.completedAt
    ? (session.completedAt as any)._seconds
      ? new Date((session.completedAt as any)._seconds * 1000)
      : new Date(session.completedAt)
    : new Date(session.updatedAt);

  const dateString = session.userTimezone
    ? completedDate.toLocaleString('en-US', { timeZone: session.userTimezone })
    : completedDate.toLocaleString('en-US');

  summary += `Research completed on: ${dateString}\n\n`;

  summary += `Key Insights:\n`;
  summary += `- Research conducted using OpenAI's Deep Research API\n`;
  summary += `- Cross-referenced with Google Gemini API\n`;
  summary += `- Full detailed report attached as PDF\n\n`;

  summary += `Please find the complete research report attached.\n`;

  return summary;
}

function generateEmailHTML(session: ResearchSession, textSummary: string): string {
  const completedDate = session.completedAt
    ? (session.completedAt as any)._seconds
      ? new Date((session.completedAt as any)._seconds * 1000)
      : new Date(session.completedAt)
    : new Date(session.updatedAt);

  const dateString = session.userTimezone
    ? completedDate.toLocaleString('en-US', { timeZone: session.userTimezone })
    : completedDate.toLocaleString('en-US');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Research Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .content {
      background: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .prompt-box {
      background: white;
      padding: 15px;
      border-left: 4px solid #667eea;
      margin: 15px 0;
      border-radius: 4px;
    }
    .questions {
      background: white;
      padding: 15px;
      border-radius: 4px;
      margin: 15px 0;
    }
    .questions h3 {
      margin-top: 0;
      color: #667eea;
    }
    .question-item {
      margin: 10px 0;
      padding: 10px;
      background: #f9fafb;
      border-radius: 4px;
    }
    .footer {
      text-align: center;
      color: #666;
      font-size: 12px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: #10b981;
      color: white;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 Your Research Report is Ready!</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">Deep Research powered by OpenAI & Google Gemini</p>
  </div>

  <div class="content">
    <h2 style="margin-top: 0;">Research Summary</h2>

    <div class="prompt-box">
      <strong>Your Research Prompt:</strong>
      <p style="margin: 8px 0 0 0;">${session.initialPrompt}</p>
    </div>

    ${session.refinementQuestions.length > 0 ? `
    <div class="questions">
      <h3>Refinement Questions</h3>
      ${session.refinementQuestions.map((q, index) => `
        <div class="question-item">
          <strong>Q${index + 1}:</strong> ${q.question}<br>
          ${q.answer ? `<strong>A:</strong> ${q.answer}` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div style="margin-top: 20px;">
      <span class="badge">✓ Completed</span>
      <p><strong>Completed:</strong> ${dateString}</p>
    </div>

    <div style="background: white; padding: 15px; border-radius: 4px; margin-top: 15px;">
      <h3 style="margin-top: 0;">📊 What's Included</h3>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Comprehensive research findings from OpenAI's Deep Research API</li>
        <li>Cross-referenced analysis using Google Gemini API</li>
        <li>Detailed insights, sources, and citations</li>
        <li>Professional PDF report (attached)</li>
      </ul>
    </div>

    ${session.webSources && session.webSources.length > 0 ? `
    <div style="background: white; padding: 15px; border-radius: 4px; margin-top: 15px;">
      <h3 style="margin-top: 0;">🌐 Web Sources</h3>
      <ul style="margin: 0; padding-left: 20px;">
        ${session.webSources.map(source => `
          <li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>
        `).join('')}
      </ul>
    </div>
    ` : ''}

    <div style="text-align: center; margin-top: 30px;">
      <p style="color: #666; font-size: 14px;">
        📎 The complete research report is attached as a PDF document
      </p>
    </div>
  </div>

  <div class="footer">
    <p>Generated by RAG Research Assistant</p>
    <p>Session ID: ${session.id}</p>
  </div>
</body>
</html>
  `;
}
