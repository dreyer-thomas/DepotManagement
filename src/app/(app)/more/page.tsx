import type { Metadata } from "next";
import { MoreLinks } from "@/app/_components/MoreLinks";
import { PageTitle } from "@/app/_components/Placeholder";
import { openImportCount } from "../open-imports";

export const metadata: Metadata = { title: "Mehr" };

export default async function MorePage() {
  const openImports = await openImportCount();
  return (
    <>
      <PageTitle>Mehr</PageTitle>
      <MoreLinks openImports={openImports} />
    </>
  );
}
