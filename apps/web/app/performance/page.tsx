import { redirect } from "next/navigation";

/** The Performance leaderboard grew into ATLAS Arena; its methodology view lives in Arena → Methodology. */
export default function Performance() {
  redirect("/arena?tab=analysts");
}
