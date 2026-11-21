Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Jona\Documents\coding project\TM_Opera_O"
sh.Run """C:\Users\Jona\Documents\coding project\TM_Opera_O\node_modules\electron\dist\electron.exe"" ""C:\Users\Jona\Documents\coding project\TM_Opera_O""", 1, False
