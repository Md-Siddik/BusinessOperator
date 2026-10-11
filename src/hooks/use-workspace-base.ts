"use client";

import { usePathname } from "next/navigation";

/** Internal area of the current page: the owner dashboard or the staff workspace. */
export function useWorkspaceBase(): "/dashboard" | "/staff" {
  return usePathname().startsWith("/staff") ? "/staff" : "/dashboard";
}
