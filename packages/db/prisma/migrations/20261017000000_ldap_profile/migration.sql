-- A company directory brings the phone, the team and the birthday too
ALTER TABLE "LdapDirectory" ADD COLUMN     "phoneAttribute" TEXT NOT NULL DEFAULT 'telephoneNumber',
ADD COLUMN     "teamAttribute" TEXT NOT NULL DEFAULT 'department',
ADD COLUMN     "birthdayAttribute" TEXT NOT NULL DEFAULT '';
