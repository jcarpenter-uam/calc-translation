import { env } from "../core/config";
import { logger } from "../core/logger";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_MAX_ATTEMPTS = 5;
const GRAPH_INITIAL_RETRY_DELAY_MS = 1000;

export interface MailAttachment {
  filename: string;
  contentType: string;
  contentBytesBase64: string;
}

export interface SendMailRequest {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface MailSender {
  sendMail(request: SendMailRequest): Promise<void>;
}

type TokenPayload = {
  access_token?: string;
  expires_in?: number;
};

type GraphMailerDependencies = {
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  senderEmail?: string;
};

export class GraphApiMailer implements MailSender {
  private readonly fetchImpl: typeof fetch;

  private readonly sleepImpl: (delayMs: number) => Promise<void>;

  private readonly tenantId: string | null;

  private readonly clientId: string | null;

  private readonly clientSecret: string | null;

  private readonly senderEmail: string | null;

  private accessToken: string | null = null;

  private accessTokenExpiresAtMs = 0;

  constructor({
    fetchImpl,
    sleepImpl,
    tenantId,
    clientId,
    clientSecret,
    senderEmail,
  }: GraphMailerDependencies = {}) {
    this.fetchImpl = fetchImpl ?? fetch;
    this.sleepImpl = sleepImpl ?? ((delayMs) => Bun.sleep(delayMs));
    this.tenantId = tenantId ?? env.MAILER_TENANT_ID ?? null;
    this.clientId = clientId ?? env.MAILER_CLIENT_ID ?? null;
    this.clientSecret = clientSecret ?? env.MAILER_CLIENT_SECRET ?? null;
    this.senderEmail = senderEmail ?? env.MAILER_SENDER_EMAIL ?? null;
  }

  async sendMail(request: SendMailRequest) {
    if (!this.isConfigured()) {
      throw new Error("Graph mailer is not configured.");
    }

    let delayMs = GRAPH_INITIAL_RETRY_DELAY_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= GRAPH_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.executeSendMailRequest(request);
        return;
      } catch (error) {
        lastError = error;
        const retryAfterMs = error instanceof RetryableMailError ? error.retryAfterMs : null;
        const retryable = error instanceof RetryableMailError;
        if (!retryable || attempt >= GRAPH_MAX_ATTEMPTS) {
          break;
        }

        const effectiveDelayMs = retryAfterMs ?? delayMs;
        logger.warn("Graph mail request failed; retrying.", {
          recipient: request.to,
          subject: request.subject,
          attempt,
          nextDelayMs: effectiveDelayMs,
          errorMessage: error.message,
        });
        await this.sleepImpl(effectiveDelayMs);
        if (!retryAfterMs) {
          delayMs *= 2;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  isConfigured() {
    return Boolean(
      this.tenantId &&
      this.clientId &&
      this.clientSecret &&
      this.senderEmail,
    );
  }

  private async executeSendMailRequest(request: SendMailRequest) {
    const accessToken = await this.getAccessToken();
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.senderEmail || "")}/sendMail`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: request.subject,
          body: {
            contentType: "HTML",
            content: request.html,
          },
          toRecipients: [
            {
              emailAddress: {
                address: request.to,
              },
            },
          ],
          attachments: (request.attachments || []).map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.filename,
            contentType: attachment.contentType,
            contentBytes: attachment.contentBytesBase64,
          })),
        },
        saveToSentItems: false,
      }),
    });

    if (response.ok) {
      return;
    }

    const responseBody = await response.text();
    if (response.status === 401) {
      this.accessToken = null;
      this.accessTokenExpiresAtMs = 0;
      throw new RetryableMailError(
        `Graph sendMail unauthorized (${response.status}): ${responseBody}`,
      );
    }

    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new RetryableMailError(
        `Graph sendMail failed (${response.status}): ${responseBody}`,
        parseRetryAfterMs(response.headers.get("Retry-After")),
      );
    }

    throw new Error(`Graph sendMail failed (${response.status}): ${responseBody}`);
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAtMs) {
      return this.accessToken;
    }

    const tokenEndpoint = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.clientId || "",
      client_secret: this.clientSecret || "",
      grant_type: "client_credentials",
      scope: GRAPH_SCOPE,
    });

    const response = await this.fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new RetryableMailError(
          `Graph token request failed (${response.status}): ${responseBody}`,
          parseRetryAfterMs(response.headers.get("Retry-After")),
        );
      }

      throw new Error(`Graph token request failed (${response.status}): ${responseBody}`);
    }

    const payload = (await response.json()) as TokenPayload;
    if (!payload.access_token) {
      throw new Error("Graph token response did not include an access token.");
    }

    const expiresInSeconds = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAtMs = Date.now() + Math.max(0, expiresInSeconds - 60) * 1000;
    return this.accessToken;
  }
}

class RetryableMailError extends Error {
  override name = "RetryableMailError";

  constructor(message: string, readonly retryAfterMs: number | null = null) {
    super(message);
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const parsedSeconds = Number.parseInt(value, 10);
  if (Number.isNaN(parsedSeconds) || parsedSeconds < 0) {
    return null;
  }

  return parsedSeconds * 1000;
}

export class GraphMailerService {
  private mailer: MailSender;

  constructor(mailer: MailSender = new GraphApiMailer()) {
    this.mailer = mailer;
  }

  isConfigured() {
    return this.mailer instanceof GraphApiMailer ? this.mailer.isConfigured() : true;
  }

  setMailerForTests(mailer: MailSender) {
    this.mailer = mailer;
  }

  resetMailerForTests() {
    this.mailer = new GraphApiMailer();
  }

  async sendMail(request: SendMailRequest) {
    await this.mailer.sendMail(request);
  }
}

export const graphMailerService = new GraphMailerService();
