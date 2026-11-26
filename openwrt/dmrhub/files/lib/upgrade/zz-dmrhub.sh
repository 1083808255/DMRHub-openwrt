# sysupgrade hook: keep SQLite's live files out of the configuration archive.
#
# The database lives on the data partition (init.d/dmrhub-data) and that
# partition does not belong to the backup at all, so normally this hook has
# nothing to do. It stays as a guard for installs where the data partition
# could not be created: there /opt/dmrhub still sits in the rootfs overlay and
# a previous version of keep.d may have put it in the archive. Drop the live
# files and the quarantined evidence copies (DMRHub.db.bad-*), which are large
# and once overflowed the boot partition that stages the archive.

dmrhub_filter_backup_db() {
	local list="$1"
	[ -f "$list" ] || return 0
	grep -Ev '^/?opt/dmrhub/data/DMRHub\.db(-wal|-shm)?$|^/?opt/dmrhub/data/DMRHub\.db\.(bad-.*|good\.tmp.*)$' \
		"$list" > "$list.dmrhub" || true
	mv -f "$list.dmrhub" "$list"
}

case " $sysupgrade_init_conffiles " in
*" dmrhub_filter_backup_db "*) ;;
*) sysupgrade_init_conffiles="$sysupgrade_init_conffiles dmrhub_filter_backup_db" ;;
esac
