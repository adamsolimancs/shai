"use client";

import SearchCombobox from "@/components/SearchCombobox";

type PlayerProfileSearchProps = {
  initialValue?: string;
};

export default function PlayerProfileSearch({ initialValue = "" }: PlayerProfileSearchProps) {
  return (
    <SearchCombobox
      id="player-profile-search"
      initialValue={initialValue}
      placeholder="Jump to a player or team"
      showLeadingButton={false}
      formClassName="rounded-3xl border border-white/10 bg-slate-950/40 p-6"
      fieldClassName="grid gap-4 md:grid-cols-[2fr_auto]"
      inputWrapperClassName="min-w-0"
      inputClassName="w-full rounded-2xl border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none"
      submitButtonClassName="btn-primary flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold"
    />
  );
}
