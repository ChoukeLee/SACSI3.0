using System;
using System.Security.Cryptography;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// No key files, command-line secrets or PowerShell execution-policy changes.
internal static class SessionProtection {
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass, byte[] info, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    private static void RecoverLock(string path) {
        if (Path.GetFileName(path) != "operation.lock" || !Path.IsPathRooted(path)) throw new Exception();
        if (!File.Exists(path)) return;
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new Exception();
        // Exclusive handle prevents a second recovery or a new writer replacing
        // this checked lock between the liveness check and deletion.
        using (var handle = CreateFile(path,0x80010000,0,IntPtr.Zero,3,0x00200000,IntPtr.Zero)) {
          if (handle.IsInvalid) throw new Exception();
          using (var stream = new FileStream(handle, FileAccess.Read)) {
            if (stream.Length > 128) throw new Exception();
            byte[] bytes = new byte[(int)stream.Length]; stream.Read(bytes, 0, bytes.Length);
            string[] lines = Encoding.UTF8.GetString(bytes).Split('\n'); int pid;
            if (lines.Length != 3 || lines[0] != "sacsi-lock-v1" || !int.TryParse(lines[1],out pid) || pid < 1) throw new Exception();
            bool dead=false;
            try { using (var process=Process.GetProcessById(pid)) { dead=process.HasExited; } }
            catch (ArgumentException) { dead=true; }
            if (!dead || !SetFileInformationByHandle(stream.SafeFileHandle,4,new byte[]{1},1)) throw new Exception();
          }
        }
    }
    private static int Main(string[] args) {
        try {
            if (args.Length != 1 || (args[0] != "protect" && args[0] != "unprotect" && args[0] != "recover-lock")) return 2;
            string encoded = Console.In.ReadToEnd();
            if (encoded.Length > 12582912) return 2;
            byte[] input = Convert.FromBase64String(encoded.Trim());
            if (args[0] == "recover-lock") { RecoverLock(Encoding.UTF8.GetString(input)); Console.Out.Write(Convert.ToBase64String(Encoding.UTF8.GetBytes("recovered"))); return 0; }
            byte[] output = args[0] == "protect"
                ? ProtectedData.Protect(input, null, DataProtectionScope.CurrentUser)
                : ProtectedData.Unprotect(input, null, DataProtectionScope.CurrentUser);
            Console.Out.Write(Convert.ToBase64String(output));
            Array.Clear(input, 0, input.Length);
            Array.Clear(output, 0, output.Length);
            return 0;
        } catch { Console.Error.Write("secure_session_storage_unavailable"); return 1; }
    }
}
