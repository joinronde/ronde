import { setStrictMessages } from "@ronde/i18n";

// A missing or invalid message is a bug: make it fail the test instead of falling back to the key
setStrictMessages(true);
