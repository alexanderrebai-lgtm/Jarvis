/** Construction et lecture des mails au format RFC 2822 utilisé par l'API Gmail. */

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  inReplyTo?: string;
  references?: string;
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildRawMail(mail: OutgoingMail): string {
  const headers = [
    `To: ${stripLineBreaks(mail.to)}`,
    ...(mail.cc ? [`Cc: ${stripLineBreaks(mail.cc)}`] : []),
    `Subject: ${encodeHeader(stripLineBreaks(mail.subject))}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${stripLineBreaks(mail.inReplyTo)}`] : []),
    ...(mail.references ? [`References: ${stripLineBreaks(mail.references)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = Buffer.from(mail.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

export interface MailPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MailPart[] | null;
}

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texte lisible d'un mail : la partie texte brut, sinon la partie HTML convertie. */
export function extractText(part: MailPart | undefined | null): string {
  if (!part) return "";
  const find = (p: MailPart, type: string): string | undefined => {
    if (p.mimeType === type && p.body?.data) return decode(p.body.data);
    for (const child of p.parts ?? []) {
      const found = find(child, type);
      if (found) return found;
    }
    return undefined;
  };
  const plain = find(part, "text/plain");
  if (plain) return plain.trim();
  const html = find(part, "text/html");
  if (html) return htmlToText(html);
  return part.body?.data ? decode(part.body.data).trim() : "";
}

/** Adresse e-mail seule à partir de « Nom <adresse> ». */
export function emailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1]! : from).trim();
}
