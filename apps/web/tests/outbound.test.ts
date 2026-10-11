import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isPrivateAddress, OutboundBlocked, outboundFetch } from "@/lib/server/outbound";

// Configured addresses (webhooks, GitLab, calendars…): in the cloud, nothing on a private network is reached

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  delete process.env.RONDE_CLOUD;
  delete process.env.RONDE_OUTBOUND_ALLOW;
});

/** The reason a request failed (undici wraps it in a "fetch failed") */
const failure = (url: string) =>
  outboundFetch(url).then(
    () => null,
    (e: Error) => (e.cause as Error | undefined) ?? e,
  );

describe("outbound requests", () => {
  it("knows the private, loopback and link-local addresses", () => {
    for (const ip of [
      "10.1.2.3",
      "172.20.0.5",
      "192.168.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(isPrivateAddress("not-an-address")).toBe(true);
  });

  it("reaches the local network on a self-hosted instance", async () => {
    expect(await (await outboundFetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
  });

  it("refuses private addresses in the cloud, written as such or behind a name", async () => {
    process.env.RONDE_CLOUD = "1";
    expect(await failure(`http://127.0.0.1:${port}/`)).toBeInstanceOf(OutboundBlocked);
    expect(await failure(`http://localhost:${port}/`)).toBeInstanceOf(OutboundBlocked);
    expect(await failure(`http://[::1]:${port}/`)).toBeInstanceOf(OutboundBlocked);
  });

  it("lets through the hosts the instance names", async () => {
    process.env.RONDE_CLOUD = "1";
    process.env.RONDE_OUTBOUND_ALLOW = "localhost";
    expect(await (await outboundFetch(`http://localhost:${port}/`)).text()).toBe("ok");
  });
});
