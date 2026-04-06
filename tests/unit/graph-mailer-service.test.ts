import { describe, expect, it } from "bun:test";
import { GraphApiMailer, GraphMailerService } from "../../services/graphMailerService";

describe("graph mailer service", () => {
  it("retries transient sendMail failures", async () => {
    let tokenRequests = 0;
    let mailRequests = 0;
    const delays: number[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2/v2.0/token")) {
        tokenRequests += 1;
        return new Response(
          JSON.stringify({ access_token: "token-1", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      mailRequests += 1;
      if (mailRequests < 3) {
        return new Response("busy", { status: 503 });
      }

      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const service = new GraphMailerService(
      new GraphApiMailer({
        fetchImpl,
        sleepImpl: async (delayMs) => {
          delays.push(delayMs);
        },
        tenantId: "tenant-id",
        clientId: "client-id",
        clientSecret: "client-secret",
        senderEmail: "sender@test.com",
      }),
    );

    await service.sendMail({
      to: "recipient@test.com",
      subject: "subject",
      html: "<p>Hello</p>",
      attachments: [],
    });

    expect(tokenRequests).toBe(1);
    expect(mailRequests).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });
});
