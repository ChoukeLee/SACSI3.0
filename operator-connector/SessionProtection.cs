using System;
using System.Security.Cryptography;

// No key files, command-line secrets or PowerShell execution-policy changes.
internal static class SessionProtection {
    private static int Main(string[] args) {
        try {
            if (args.Length != 1 || (args[0] != "protect" && args[0] != "unprotect")) return 2;
            string encoded = Console.In.ReadToEnd();
            if (encoded.Length > 131072) return 2;
            byte[] input = Convert.FromBase64String(encoded.Trim());
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
