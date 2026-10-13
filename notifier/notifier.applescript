-- Course Hub notifier. Course Hub writes data/notify/pending.txt (title, subtitle, body, url — one per line) and
-- launches this applet, which shows the notice under the "Course Hub" name. Clicking a notice launches the
-- applet again with nothing pending, and it opens the page the last notice pointed to.
on run
	set appPath to POSIX path of (path to me)
	set rootDir to do shell script "cd " & quoted form of appPath & "/../.. && pwd"
	set notifyDir to rootDir & "/data/notify"
	set pendingFile to notifyDir & "/pending.txt"
	set lastFile to notifyDir & "/last-url.txt"
	set raw to ""
	try
		set raw to do shell script "cat " & quoted form of pendingFile & " && rm -f " & quoted form of pendingFile
	end try
	if raw is not "" then
		set AppleScript's text item delimiters to {linefeed, return}
		set parts to text items of raw
		set AppleScript's text item delimiters to ""
		set t to item 1 of parts
		set s to ""
		set b to ""
		set u to ""
		if (count of parts) >= 2 then set s to item 2 of parts
		if (count of parts) >= 3 then set b to item 3 of parts
		if (count of parts) >= 4 then set u to item 4 of parts
		if u is not "" then do shell script "printf %s " & quoted form of u & " > " & quoted form of lastFile
		if s is "" then
			display notification b with title t
		else
			display notification b with title t subtitle s
		end if
		delay 1
	else
		set u to "http://127.0.0.1:4123/"
		try
			set saved to do shell script "cat " & quoted form of lastFile
			if saved is not "" then set u to saved
		end try
		open location u
	end if
end run
