using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using Microsoft.Win32;

internal static class Upgrade {
    const string Registration=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Carnot Agent Engine";
    const string Work=".carnot-setup-update";
    const string Signature="Carnot desktop setup transaction v1";
    const string Private="carnot-private-env";
    const string Modules=@"payload\app\node_modules";
    static readonly string[] ProgramEntries={
        @"payload\app\dist", @"payload\app\scripts", @"payload\app\docs", @"payload\app\plugins",
        @"payload\app\package.json", @"payload\app\LICENSE", "carnot-desktop.ico",
        "remove-carnot-environment.exe", "uninstall.exe", "carnot-desktop.exe"
    };
    static readonly string[] DependencyEntries={Private, Private+@"\packages", Modules};
    internal static Version Target {
        get {using(var reader=new StreamReader(SetupEnvironment.Resource("version.txt")))return Version.Parse(reader.ReadToEnd().Trim());}
    }
    internal sealed class Installed {
        internal readonly string Root;
        internal readonly Version Version;
        internal Installed(string root, Version version){Root=root;Version=version;}
    }
    internal static Installed Find() {
        using(var key=Registry.CurrentUser.OpenSubKey(Registration)){
            if(key==null)return null;
            var root=Convert.ToString(key.GetValue("InstallLocation")).Trim('"');
            Version version;
            if(!Path.IsPathRooted(root)||!String.Equals(Convert.ToString(key.GetValue("UninstallString")).Trim('"'),Path.Combine(root,"uninstall.exe"),StringComparison.OrdinalIgnoreCase)
                ||Convert.ToString(key.GetValue("DisplayName"))!=SetupEnvironment.Product||!Version.TryParse(Convert.ToString(key.GetValue("DisplayVersion")),out version))
                throw new IOException("The registered Carnot installation is incomplete. Check its installation folder in Windows Settings.");
            root=Path.GetFullPath(root).TrimEnd('\\');
            if(!String.Equals(Path.GetFileName(root),SetupEnvironment.Product,StringComparison.OrdinalIgnoreCase)||!Directory.Exists(root))
                throw new IOException("The registered Carnot installation folder is unavailable.");
            return new Installed(root,version);
        }
    }
    static FileAttributes? Attributes(string path){
        try{return File.GetAttributes(path);}catch(FileNotFoundException){return null;}catch(DirectoryNotFoundException){return null;}
    }
    static void PlainDirectory(string path){
        var attr=Attributes(path);
        if(attr==null||(attr.Value&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=FileAttributes.Directory)
            throw new IOException("Expected an ordinary installation directory at "+path);
    }
    static void Move(string source,string target){
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        if((File.GetAttributes(source)&FileAttributes.Directory)!=0)Directory.Move(source,target);
        else File.Move(source,target);
    }
    // Never recurse through junctions, including a backed-up external modules link.
    static void Remove(string path){
        RemovePrivate.DeleteOwnedEntry(path);
    }
    static void WriteAtomic(string path,string content){
        using(var file=new FileStream(path+".new",FileMode.Create,FileAccess.Write,FileShare.None)){
            var bytes=Encoding.UTF8.GetBytes(content);file.Write(bytes,0,bytes.Length);file.Flush(true);
        }
        File.Move(path+".new",path);
    }
    static void ClearTransaction(string work){
        // A crash during cleanup must leave the ownership marker until the end.
        foreach(var entry in Directory.GetFileSystemEntries(work))
            if(Path.GetFileName(entry)!="owner")Remove(entry);
        File.Delete(Path.Combine(work,"owner"));Directory.Delete(work);
    }
    internal static void Recover(string root,Version registered) {
        string work=Path.Combine(root,Work);
        if(!Directory.Exists(work))return;
        PlainDirectory(work);
        if(!Directory.EnumerateFileSystemEntries(work).Any()){Directory.Delete(work);return;}
        if(File.ReadAllText(Path.Combine(work,"owner"))!=Signature)throw new IOException("Unrecognized setup update directory: "+work);
        var journal=Path.Combine(work,"plan");
        if(File.Exists(journal)){
            var lines=File.ReadAllLines(journal);
            // DisplayVersion is written only after every replacement is in place.
            if(registered!=Version.Parse(lines[0])){
                foreach(var line in lines.Skip(1).Reverse()){
                    var entry=line.Substring(2);
                    if(!ProgramEntries.Concat(DependencyEntries).Contains(entry)||(line[0]!='0'&&line[0]!='1')||line[1]!=' ')
                        throw new InvalidDataException("Invalid setup recovery journal.");
                    var live=Path.Combine(root,entry);var old=Path.Combine(work,"before",entry);
                    if(Attributes(old)!=null){Remove(live);Move(old,live);}
                    else if(line[0]=='0')Remove(live);
                }
            }
            File.Delete(journal);
        }
        ClearTransaction(work);
    }
    // Write-ahead plan lets a new setup process undo even a half-finished rename.
    internal static void Replace(string root,string[] entries,Version target,Action commit) {
        var work=Path.Combine(root,Work);
        WriteAtomic(Path.Combine(work,"plan"),String.Join("\n",new[]{target.ToString()}.Concat(entries.Select(e=>(Attributes(Path.Combine(root,e))==null?"0 ":"1 ")+e))));
        foreach(var entry in entries){
            var live=Path.Combine(root,entry);
            if(Attributes(live)!=null)Move(live,Path.Combine(work,"before",entry));
            Move(Path.Combine(work,"after",entry),live);
        }
        commit();
    }
    internal static string Begin(string root){
        var work=Path.Combine(root,Work);
        Directory.CreateDirectory(work);
        File.WriteAllText(Path.Combine(work,"owner"),Signature);
        var after=Path.Combine(work,"after");Directory.CreateDirectory(after);return after;
    }
    static void WaitForShell(string root,Action<string> status){
        var path=Path.Combine(root,"carnot-desktop.exe");
        var deadline=DateTime.UtcNow.AddSeconds(60);
        foreach(var process in Process.GetProcessesByName("carnot-desktop"))using(process){
            string actual;
            try{actual=process.MainModule.FileName;}catch(InvalidOperationException){continue;}catch(System.ComponentModel.Win32Exception){continue;}
            if(!String.Equals(actual,path,StringComparison.OrdinalIgnoreCase))continue;
            status("Close Carnot Agent Engine to continue the update.");
            if(!process.WaitForExit((int)Math.Max(1,(deadline-DateTime.UtcNow).TotalMilliseconds)))
                throw new IOException("Close Carnot Agent Engine, then run the update again.");
        }
    }
    static void PrepareModules(string root,string physicalRoot,string after,string node,List<string> entries,Action<string> status){
        var link=Path.Combine(root,Modules);
        var attrs=Attributes(link);
        if(attrs==null||(attrs.Value&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=(FileAttributes.Directory|FileAttributes.ReparsePoint))
            throw new IOException("The installed Carnot package link is unavailable.");
        if(SetupEnvironment.CompatibleModules(link))return;
        status("Preparing dependencies for this release…");
        string stage=Path.Combine(Path.GetDirectoryName(after),"dependencies");
        Directory.CreateDirectory(stage);
        SetupEnvironment.Extract("packages.mjs",Path.Combine(stage,"packages.mjs"));
        SetupEnvironment.Extract("package-lock.json",Path.Combine(stage,"package-lock.json"));
        var sources=SetupEnvironment.Versions.ToDictionary(p=>p.Key,p=>SetupEnvironment.InstalledVersion(Path.Combine(link,p.Key),p.Key)==p.Value?Path.Combine(link,p.Key):null);
        File.WriteAllText(Path.Combine(stage,"sources.json"),new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(sources));
        SetupEnvironment.Run(node,"packages.mjs",stage);
        string packages=Path.Combine(stage,@"private\packages");
        if(!SetupEnvironment.CompatibleModules(Path.Combine(packages,"node_modules")))throw new IOException("Updated packages failed validation.");
        string owned=Path.Combine(root,Private);
        var privateEntry=Private;
        if(Attributes(owned)!=null){
            PlainDirectory(owned);
            if(!File.Exists(Path.Combine(owned,".carnot-owned")))throw new IOException("The private package destination is not owned by setup.");
            privateEntry=Private+@"\packages";
        }
        Move(packages,Path.Combine(after,Private,"packages"));
        File.WriteAllText(Path.Combine(after,Private,".carnot-owned"),"Carnot desktop setup");
        var vars=new Dictionary<string,string>{{"CARNOT_NEW_PACKAGES",Path.Combine(physicalRoot,Private,@"packages\node_modules")},{"CARNOT_NEW_LINK",Path.Combine(after,Modules)}};
        SetupEnvironment.Run(node,"-e \"require('fs').symlinkSync(process.env.CARNOT_NEW_PACKAGES,process.env.CARNOT_NEW_LINK,'junction')\"",stage,vars);
        entries.Add(privateEntry);entries.Add(Modules);
    }
    internal static void Apply(Installed install,Action<string> status){
        ApplyTo(install.Root,delegate{
            var current=Find();
            if(current==null||!String.Equals(current.Root,install.Root,StringComparison.OrdinalIgnoreCase))throw new IOException("The registered installation changed.");
            return current.Version;
        },delegate(Version version){
            using(var key=Registry.CurrentUser.OpenSubKey(Registration,true)){
                key.SetValue("DisplayVersion",version.ToString());key.Flush();
            }
        },status);
    }
    internal static void ApplyTo(string physicalRoot,Func<Version> readVersion,Action<Version> writeVersion,Action<string> status){
        PlainDirectory(physicalRoot);
        using(var alias=new SetupEnvironment.ShortPath(physicalRoot)){
        var root=alias.PathName;
        PlainDirectory(Path.Combine(root,"payload"));PlainDirectory(Path.Combine(root,@"payload\app"));
        using(new FileStream(Path.Combine(root,".carnot-updating.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None,1,FileOptions.DeleteOnClose)){
            var current=readVersion();
            Recover(root,current);
            if(current>Target)throw new IOException("A newer Carnot version is already installed.");
            if(current==Target)return;
            if(!File.Exists(Path.Combine(root,"uninstall.exe"))||!File.Exists(Path.Combine(root,"carnot-desktop.exe")))throw new IOException("The installed application files are missing.");
            WaitForShell(physicalRoot,status);
            string node=DependencyRecovery.Resolve(physicalRoot,true);
            var after=Begin(root);
            try{
                status("Preparing Carnot "+Target+"…");
                var work=Path.GetDirectoryName(after);var core=Path.Combine(work,"core.exe");
                SetupEnvironment.Extract("core.exe",core);
                SetupEnvironment.Run(core,"/S /UPDATE /CARNOTSTAGE /D="+after,work);
                foreach(var entry in ProgramEntries)if(Attributes(Path.Combine(after,entry))==null)throw new IOException("The update image is missing "+entry);
                if(File.Exists(Path.Combine(root,@"payload\app\dist\web\basic-physics-map.mjs")))
                    SetupEnvironment.Extract("physics-map.js",Path.Combine(after,@"payload\app\dist\web\basic-physics-map.mjs"));
                var entries=new List<string>(ProgramEntries);
                PrepareModules(root,physicalRoot,after,node,entries,status);
                status("Updating the installed program…");
                Replace(root,entries.ToArray(),Target,()=>writeVersion(Target));
            }finally{Recover(root,readVersion());}
        }
        }
    }
}
