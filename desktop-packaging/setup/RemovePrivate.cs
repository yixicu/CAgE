using System;
using System.IO;
using System.Runtime.InteropServices;
using System.ComponentModel;

// Shipped beside the app. Only the installation-owned runtime tree may be traversed.
// External module junctions belong to the user and are removed as directory entries.
internal class RemovePrivate {
    const uint Invalid=0xffffffff, DirectoryFlag=16, Reparse=1024, ReadOnly=1;
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct Entry {
        public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME creation,access,write;
        public uint sizeHigh,sizeLow,reserved0,reserved1;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string name;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=14)]public string alternate;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr FindFirstFileW(string path,out Entry data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool FindNextFileW(IntPtr search,out Entry data);
    [DllImport("kernel32.dll")]static extern bool FindClose(IntPtr h);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFileAttributesW(string path);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool SetFileAttributesW(string path,uint value);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool DeleteFileW(string path);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool RemoveDirectoryW(string path);
    static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
    static void DeleteEntry(string path,uint attributes){
        bool dir=(attributes&DirectoryFlag)!=0;
        if(dir&&(attributes&Reparse)==0){
            Entry e;var h=FindFirstFileW(path+@"\*",out e);
            if(h==new IntPtr(-1))throw new Win32Exception();
            try{
                do{if(e.name!="."&&e.name!="..")DeleteEntry(path+"\\"+e.name,e.attributes);}while(FindNextFileW(h,out e));
                if(Marshal.GetLastWin32Error()!=18)throw new Win32Exception();
            }finally{FindClose(h);}
        }
        if((attributes&(ReadOnly|Reparse))==ReadOnly)Check(SetFileAttributesW(path,attributes&~ReadOnly));
        Check(dir?RemoveDirectoryW(path):DeleteFileW(path));
    }
    internal static void DeleteOwnedEntry(string path){
        string full=Path.GetFullPath(path);
        string native=full.StartsWith(@"\\")?@"\\?\UNC\"+full.Substring(2):@"\\?\"+full;
        uint attributes=GetFileAttributesW(native);
        if(attributes!=Invalid){DeleteEntry(native,attributes);return;}
        int error=Marshal.GetLastWin32Error();
        if(error!=2&&error!=3)throw new Win32Exception(error);
    }
    static int Main(){
        try {
            string root=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
            if(root.StartsWith(@"\\")||root.Length<4)return 2;
            string prefix=@"\\?\"+root+@"\";
            foreach(var dir in new[]{"payload",@"payload\app"}){
                uint a=GetFileAttributesW(prefix+dir);
                if(a!=Invalid&&(a&Reparse)!=0)return 2;
            }
            string link=prefix+@"payload\app\node_modules";uint attr=GetFileAttributesW(link);
            if(attr!=Invalid){
                if((attr&(Reparse|DirectoryFlag))!=(Reparse|DirectoryFlag))return 2;
                Check(RemoveDirectoryW(link));
            }
            string own=prefix+"carnot-private-env";attr=GetFileAttributesW(own);
            if(attr==Invalid)return 0;
            if((attr&(DirectoryFlag|Reparse))!=DirectoryFlag || !File.Exists(Path.Combine(root,@"carnot-private-env\.carnot-owned")))return 2;
            DeleteEntry(own,attr);return 0;
        }catch{return 1;}
    }
}
