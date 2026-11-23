<script setup lang="ts" generic="TData extends Record<string, unknown>">
import { computed } from "vue"
import { Button as ShadButton } from "@/components/ui/button"
import { t } from "@/i18n"
import type { DataTableInstance } from "./features"

const props = defineProps<{
  table: DataTableInstance<TData>
  summary?: string
}>()

/* One sentence with both numbers, so a language can put them where it likes. */
const pageLabel = computed(() => {
  const page = props.table.atoms.pagination.get().pageIndex + 1
  const pages = props.table.getPageCount()
  return pages > 0 ? t("Page {page} of {pages}", { page, pages }) : t("Page {page}", { page })
})
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="text-sm text-muted-foreground">
      {{ pageLabel }}
      <span v-if="summary"> · {{ summary }}</span>
    </div>
    <div class="flex items-center gap-2">
      <ShadButton
        variant="outline"
        size="sm"
        :disabled="!table.getCanPreviousPage()"
        @click="table.previousPage()"
      >
        {{ $t("Previous") }}
      </ShadButton>
      <ShadButton variant="outline" size="sm" :disabled="!table.getCanNextPage()" @click="table.nextPage()">
        {{ $t("Next") }}
      </ShadButton>
    </div>
  </div>
</template>
