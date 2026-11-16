using System;
using System.IO;
using System.Reflection;

public static class VersionFixture
{
    public static int Main(string[] arguments)
    {
        if (arguments.Length != 1 || arguments[0] != "--version") return 97;
        string mode = Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location);
        switch (mode)
        {
            case "old-runtime": Console.WriteLine("v22.22.1"); return 0;
            case "wrong-major": Console.WriteLine("v23.0.0"); return 0;
            case "malformed-runtime": Console.WriteLine("GG436_RAW_VERSION_CANARY"); return 0;
            case "failed-runtime": return 28;
            default: return 98;
        }
    }
}
