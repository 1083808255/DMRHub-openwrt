<script setup lang="ts" generic="TData extends Record<string, unknown>">
import type { PaginationState, Updater } from "@tanstack/vue-table"
import { FlexRender, useTable } from "@tanstack/vue-table"
import { computed, ref, watch } from "vue"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import DataTablePagination from "./DataTablePagination.vue"
import { dataTableFeatures, type DataTableColumn } from "./features"

const props = withDefaults(
  defineProps<{
    columns: DataTableColumn<TData>[]
    data: TData[]
    loading?: boolean
    loadingText?: string
    emptyText?: string
    pageIndex?: number
    pageSize?: number
    pageCount?: number
    manualPagination?: boolean
    summary?: string
    rowClickable?: boolean
    rowSelected?: (row: TData) => boolean
    columnWidths?: Record<string, string>
  }>(),
  {
    loading: false,
    loadingText: "",
    emptyText: "",
    pageIndex: 0,
    pageSize: 30,
    pageCount: -1,
    manualPagination: false,
    summary: "",
    rowClickable: false,
    rowSelected: undefined,
    columnWidths: undefined,
  },
)

const emit = defineEmits<{
  (e: "update:pageIndex", value: number): void
  (e: "update:pageSize", value: number): void
  (e: "rowClick", value: TData): void
}>()

const pagination = ref<PaginationState>({
  pageIndex: props.pageIndex ?? 0,
  pageSize: props.pageSize ?? 30,
})

watch(
  () => [props.pageIndex, props.pageSize],
  ([pageIndex, pageSize]) => {
    pagination.value = {
      pageIndex: pageIndex ?? 0,
      pageSize: pageSize ?? 30,
    }
  },
)

const table = useTable({
  features: dataTableFeatures,
  get data() {
    return props.data
  },
  get columns() {
    return props.columns
  },
  get pageCount() {
    return props.pageCount
  },
  get manualPagination() {
    return props.manualPagination
  },
  onPaginationChange: (updaterOrValue: Updater<PaginationState>) => {
    const nextValue =
      typeof updaterOrValue === "function"
        ? updaterOrValue(pagination.value)
        : updaterOrValue

    pagination.value = nextValue
    emit("update:pageIndex", nextValue.pageIndex)
    emit("update:pageSize", nextValue.pageSize)
  },
  state: {
    get pagination() {
      return pagination.value
    },
  },
})

const interactive = "a, button, input, select, textarea, [role=button], [role=switch]"

function onRowClick(event: MouseEvent, row: TData) {
  if (!props.rowClickable) {
    return
  }
  const target = event.target as Element | null
  if (target && target.closest && target.closest(interactive)) {
    return
  }
  emit("rowClick", row)
}

function onRowKeydown(event: KeyboardEvent, row: TData) {
  if (!props.rowClickable || event.target !== event.currentTarget) {
    return
  }
  if (event.key !== "Enter" && event.key !== " ") {
    return
  }
  event.preventDefault()
  emit("rowClick", row)
}

const visibleRows = computed(() => {
  return table.getRowModel().rows
})

// Column widths only apply when the caller names them: a fixed layout keeps
// every column where the caller put it, instead of letting the content of one
// cell widen its column and push the columns after it to the right.
const hasFixedWidths = computed(() => Object.keys(props.columnWidths ?? {}).length > 0)

function columnWidth(id: string): string | undefined {
  return props.columnWidths?.[id]
}
</script>

<template>
  <div class="space-y-4">
    <Table :class="hasFixedWidths ? 'table-fixed' : undefined">
      <colgroup v-if="hasFixedWidths">
        <col
          v-for="header in table.getHeaderGroups()[0]?.headers ?? []"
          :key="header.id"
          :style="columnWidth(header.column.id) ? { width: columnWidth(header.column.id) } : undefined"
        >
      </colgroup>
      <TableHeader>
        <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
          <TableHead v-for="header in headerGroup.headers" :key="header.id">
            <FlexRender v-if="!header.isPlaceholder" :header="header" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-if="loading">
          <TableCell :colspan="columns.length" class="text-center">{{ loadingText || $t('Loading...') }}</TableCell>
        </TableRow>
        <TableRow v-else-if="visibleRows.length === 0">
          <TableCell :colspan="columns.length" class="text-center">{{ emptyText || $t('No results.') }}</TableCell>
        </TableRow>
        <template v-for="row in visibleRows" :key="row.id">
          <TableRow
            :class="rowClickable ? 'cursor-pointer' : undefined"
            :tabindex="rowClickable ? 0 : undefined"
            :data-state="rowSelected && rowSelected(row.original) ? 'selected' : undefined"
            @click="onRowClick($event, row.original)"
            @keydown="onRowKeydown($event, row.original)"
          >
            <TableCell v-for="cell in row.getAllCells()" :key="cell.id">
              <FlexRender :cell="cell" />
            </TableCell>
          </TableRow>
          <slot name="after-row" :row="row.original" :colspan="columns.length" />
        </template>
      </TableBody>
    </Table>

    <DataTablePagination :table="table" :summary="summary" />
  </div>
</template>
