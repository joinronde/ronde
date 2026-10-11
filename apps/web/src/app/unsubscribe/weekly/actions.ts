"use server";

import { redirect } from "next/navigation";
import { setWeeklySummary, validUnsubscribe } from "@/lib/server/weekly";

/** The button of the page: turns the weekly summary off for the person the signed link names */
export async function stopWeeklySummary(form: FormData) {
  const userId = String(form.get("u") ?? "");
  const token = String(form.get("t") ?? "");
  if (!userId || !validUnsubscribe(userId, token)) redirect("/unsubscribe/weekly");
  await setWeeklySummary(userId, false);
  redirect(`/unsubscribe/weekly?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}&done=1`);
}
