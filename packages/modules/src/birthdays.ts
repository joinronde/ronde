import { AccessError, defineModule, defineOp, OpError } from "@ronde/module-sdk";
import { z } from "zod";
import { none, str } from "./shared";

const birthday = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Invalid date.")
  // 2000 is a leap year: February 29 is accepted, April 31 is not
  .refine((v) => new Date(2000, Number(v.slice(0, 2)) - 1, Number(v.slice(3))).getDate() === Number(v.slice(3)), "Invalid date.");

// Birthdays (day and month, never the year) celebrated on the waiting screen of that week
export const birthdays = defineModule({
  id: "birthdays",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🎂",
  config: { schema: none, defaults: {} },
  ops: [
    defineOp({
      name: "birthdays.set",
      permission: "meeting.read",
      input: z.object({ memberId: str(50), birthday: birthday.nullable() }),
      // Personal data, shared by every meeting: the person themselves, or someone managing the directory
      run: async ({ db, m }, o) => {
        if (o.memberId !== m.viewer.personId && !m.can("people.manage")) throw new AccessError(403, "ownBirthdayOnly");
        const { count } = await db.person.updateMany({ where: { id: o.memberId }, data: { birthday: o.birthday } });
        if (!count) throw new OpError("unknownMember");
      },
    }),
  ],
});
