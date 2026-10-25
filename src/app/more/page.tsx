import type { Metadata } from "next";
import { MoreLinks } from "../_components/MoreLinks";
import { PageTitle } from "../_components/Placeholder";

export const metadata: Metadata = { title: "Mehr" };

export default function MorePage() {
  return (
    <>
      <PageTitle>Mehr</PageTitle>
      <MoreLinks />
    </>
  );
}
