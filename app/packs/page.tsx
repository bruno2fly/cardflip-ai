import { redirect } from "next/navigation";

/** The Sealed Product Tracker moved to the home page. */
export default function PacksRedirect() {
  redirect("/");
}
