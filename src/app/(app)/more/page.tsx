import type { Metadata } from "next";
import { MoreLinks } from "@/app/_components/MoreLinks";
import { PageTitle } from "@/app/_components/Placeholder";

export const metadata: Metadata = { title: "Mehr" };

export default function MorePage() {
  return (
    <>
      <PageTitle>Mehr</PageTitle>
      <MoreLinks />
    </>
  );
}
