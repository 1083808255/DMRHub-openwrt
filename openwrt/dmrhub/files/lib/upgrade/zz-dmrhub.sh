# sysupgrade hook: keep SQLite's live files out of the configuration archive.
#
# /lib/upgrade/keep.d/dmrhub keeps /opt/dmrhub, so sysupgrade archives
# DMRHub.db together with its WAL and SHM files. On this device that copy has
# produced a truncated database even after the writer was stopped. The
# dmrhub-db-protect script keeps a verified single-file snapshot at
# DMRHub.db.good, which is safe to archive and is restored at the next boot.
# Drop only the three live files; every evidence backup stays in the archive.

dmrhub_filter_backup_db() {
	local list="$1"
	[ -f "$list" ] || return 0
	grep -Ev '^/?opt/dmrhub/data/DMRHub\.db(-wal|-shm)?$' "$list" > "$list.dmrhub" || true
	mv -f "$list.dmrhub" "$list"
}

case " $sysupgrade_init_conffiles " in
*" dmrhub_filter_backup_db "*) ;;
*) sysupgrade_init_conffiles="$sysupgrade_init_conffiles dmrhub_filter_backup_db" ;;
esac
