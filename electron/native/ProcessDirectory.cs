using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class HudProcessDirectory
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicInfo
    {
        public IntPtr ExitStatus, Peb, Affinity, Priority, ProcessId, ParentId;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low, High; }
    public sealed class DirectoryInfo
    {
        public int ProcessId;
        public string WorkingDirectory;
        public string CreationId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, IntPtr size, out IntPtr read);
    [DllImport("kernel32.dll")]
    private static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")]
    private static extern int QueryBasic(IntPtr process, int infoClass, out BasicInfo info, int size, out int returned);
    [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")]
    private static extern int QueryWow64(IntPtr process, int infoClass, out IntPtr peb, int size, out int returned);

    private static byte[] Read(IntPtr process, long address, int size)
    {
        if (address <= 0 || size <= 0 || size > 32768) throw new InvalidOperationException();
        byte[] buffer = new byte[size]; IntPtr actual;
        if (!ReadProcessMemory(process, new IntPtr(address), buffer, new IntPtr(size), out actual) || actual.ToInt64() != size)
            throw new InvalidOperationException();
        return buffer;
    }
    private static long Pointer(byte[] bytes, int offset, bool x86)
    {
        return x86 ? (long)BitConverter.ToUInt32(bytes, offset) : BitConverter.ToInt64(bytes, offset);
    }
    public static DirectoryInfo ReadDirectory(int pid)
    {
        if (IntPtr.Size != 8 || pid <= 0) return null;
        IntPtr handle = OpenProcess(0x0410, false, pid);
        if (handle == IntPtr.Zero) return null;
        try
        {
            BasicInfo basic; int returned; IntPtr wowPeb;
            if (QueryBasic(handle, 0, out basic, Marshal.SizeOf(typeof(BasicInfo)), out returned) != 0 || basic.ProcessId.ToInt64() != pid)
                return null;
            if (QueryWow64(handle, 26, out wowPeb, IntPtr.Size, out returned) != 0) return null;
            bool x86 = wowPeb != IntPtr.Zero;
            long peb = x86 ? wowPeb.ToInt64() : basic.Peb.ToInt64();
            long parameters = Pointer(Read(handle, peb + (x86 ? 0x10 : 0x20), x86 ? 4 : 8), 0, x86);
            // PEB / RTL_USER_PROCESS_PARAMETERS layout. If the layout is unavailable, return no cwd.
            long currentDirectory = parameters + (x86 ? 0x24 : 0x38);
            byte[] descriptor = Read(handle, currentDirectory, x86 ? 8 : 16);
            int length = BitConverter.ToUInt16(descriptor, 0);
            int capacity = BitConverter.ToUInt16(descriptor, 2);
            if (length == 0 || length > 32766 || length > capacity || length % 2 != 0) return null;
            string path = Encoding.Unicode.GetString(Read(handle, Pointer(descriptor, x86 ? 4 : 8, x86), length));
            byte[] after = Read(handle, currentDirectory, descriptor.Length);
            for (int i = 0; i < descriptor.Length; i++) if (descriptor[i] != after[i]) return null;
            if (path.IndexOf('\0') >= 0 || !Path.IsPathRooted(path) || !Directory.Exists(path)) return null;
            FileTime created, exited, kernel, user;
            if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) return null;
            ulong creationId = ((ulong)created.High << 32) | created.Low;
            return new DirectoryInfo { ProcessId = pid, WorkingDirectory = path, CreationId = creationId.ToString(System.Globalization.CultureInfo.InvariantCulture) };
        }
        catch { return null; }
        finally { CloseHandle(handle); }
    }
}
