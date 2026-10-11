// A tiny in-process LDAP directory for tests: a service account, people, and their passwords
import ldap from "ldapjs";

export interface TestPerson {
  dn: string;
  password: string;
  attributes: Record<string, string>;
}

// What the tests use of ldapjs (its published types lag behind the library)
type Next = (error?: unknown) => void;
type Handler<Req, Res> = (req: Req, res: Res, next: Next) => void;
interface TestServer {
  bind: (base: string, handler: Handler<{ dn: { toString(): string }; credentials: string }, { end(): void }>) => void;
  search: (
    base: string,
    handler: Handler<{ filter: { matches(attributes: object): boolean } }, { send(entry: object): void; end(): void }>,
  ) => void;
  listen: (port: number, host: string, done: () => void) => void;
  address: () => { port: number };
  close: () => void;
}

export async function startDirectory(
  people: TestPerson[],
  service = { dn: "cn=ronde,ou=services,dc=acme,dc=test", password: "service-pass" },
) {
  const server = ldap.createServer() as unknown as TestServer;
  const passwords = new Map([[service.dn, service.password], ...people.map((p) => [p.dn, p.password] as const)]);
  server.bind("dc=acme,dc=test", (req, res, next) => {
    const dn = req.dn.toString().replace(/\s/g, "");
    if (passwords.get(dn) !== req.credentials) return next(new ldap.InvalidCredentialsError());
    res.end();
    return next();
  });
  server.search("dc=acme,dc=test", (req, res, next) => {
    for (const p of people) {
      const entry = { dn: p.dn, attributes: { objectclass: ["person"], ...p.attributes } };
      if (req.filter.matches(entry.attributes)) res.send(entry);
    }
    res.end();
    return next();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const port = server.address().port;
  return { url: `ldap://127.0.0.1:${port}`, service, close: () => server.close() };
}
