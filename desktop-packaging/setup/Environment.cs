using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Net;
using System.IO.Compression;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal static class SetupEnvironment {
    [System.Runtime.InteropServices.DllImport("shell32.dll")] static extern void SHChangeNotify(int change,uint flags,IntPtr item1,IntPtr item2);
    internal const string Product = "Carnot Agent Engine";
    internal const string Download = "Download for me (choose if unsure)";
    internal static readonly string DefaultInstall = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs");
    internal static readonly string[] Packages = Lines("packages.tsv");
    internal static Stream Resource(string name) { return Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throwMissing(name); }
    static Stream throwMissing(string name){throw new InvalidDataException("Missing setup resource: "+name);}
    static string[] Lines(string name){using(var s=new StreamReader(Resource(name)))return s.ReadToEnd().Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries);}
    static string At(string a,string b){return Path.Combine(a,b);}
    internal static void Extract(string name,string file){using(var s=Resource(name))using(var f=File.Create(file))s.CopyTo(f);}
    static string Q(string path){return "\""+path+"\"";}
    internal static string Run(string exe,string args,string cwd,Dictionary<string,string> vars=null,int timeout=900000) {
        var info=new ProcessStartInfo(exe,args){WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        info.EnvironmentVariables.Remove("NODE_OPTIONS");
        if(vars!=null)foreach(var item in vars)info.EnvironmentVariables[item.Key]=item.Value;
        using(var proc=Process.Start(info)){
            var output=proc.StandardOutput.ReadToEndAsync();var error=proc.StandardError.ReadToEndAsync();
            if(!proc.WaitForExit(timeout)){proc.Kill();throw new IOException("The operation timed out: "+Path.GetFileName(exe));}
            if(proc.ExitCode!=0)throw new IOException(Path.GetFileName(exe)+" failed ("+proc.ExitCode+"). "+error.Result.Trim());
            return output.Result.Trim();
        }
    }
    internal static bool CompatibleNode(string path){
        try{return File.Exists(path) && Run(path,"-p \"process.platform+' '+process.arch+' '+(process.versions.node.split('.')[0]==24 && +process.versions.node.split('.')[1]>=19)\"",Path.GetDirectoryName(path),null,8000)=="win32 x64 true";}catch{return false;}
    }
    internal static string PackageName(string slot){return slot.Split(new[]{"/node_modules/"},StringSplitOptions.None).Last();}
    internal static readonly Dictionary<string,string> Versions=Packages.Select(line=>line.Split('\t')).ToDictionary(p=>p[0],p=>p[1]);
    internal static readonly string[] Direct=DirectPackages();
    static string[] DirectPackages(){
        using(var reader=new StreamReader(Resource("package.json"))){
            var pkg=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
            return ((Dictionary<string,object>)pkg["dependencies"]).Keys.OrderBy(name=>name).ToArray();
        }
    }
    internal static string InstalledVersion(string dir,string slot){
        try{
            var pkg=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(At(dir,"package.json")));
            return Convert.ToString(pkg["name"])==PackageName(slot)?Convert.ToString(pkg["version"]):null;
        }catch{return null;}
    }
    internal static bool CompatibleModules(string root){
        return Versions.All(p=>InstalledVersion(At(root,p.Key),p.Key)==p.Value);
    }
    static IEnumerable<string> Directories(string root,string pattern){
        try{return Directory.GetDirectories(root,pattern);}catch{return new string[0];}
    }
    internal static IEnumerable<string> Nodes(){
        var paths=new List<string>();
        var own=Environment.GetEnvironmentVariable("CARNOT_NODE");if(!String.IsNullOrWhiteSpace(own))paths.Add(own);
        foreach(var dir in (Environment.GetEnvironmentVariable("PATH")??"").Split(';'))if(!String.IsNullOrWhiteSpace(dir))paths.Add(At(dir.Trim('"'),"node.exe"));
        paths.Add(At(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),@"nodejs\node.exe"));
        return paths.Distinct(StringComparer.OrdinalIgnoreCase).Where(CompatibleNode).OrderBy(p=>p.IndexOf("codex",StringComparison.OrdinalIgnoreCase)>=0 ? 1 : 0).ToArray();
    }
    internal static IEnumerable<string> Modules(string installParent){
        var paths=new List<string>();
        foreach(var key in new[]{"CARNOT_MODULES","NODE_PATH"})
            paths.AddRange((Environment.GetEnvironmentVariable(key)??"").Split(Path.PathSeparator).Select(p=>p.Trim().Trim('"')));
        string prefix=Environment.GetEnvironmentVariable("NPM_CONFIG_PREFIX");
        if(!String.IsNullOrWhiteSpace(prefix))paths.Add(At(prefix,"node_modules"));
        paths.Add(At(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),@"npm\node_modules"));
        foreach(var dir in (Environment.GetEnvironmentVariable("PATH")??"").Split(Path.PathSeparator)){
            var bin=dir.Trim().Trim('"');
            if(bin.Length>0&&File.Exists(At(bin,"node.exe")))paths.Add(At(bin,"node_modules"));
        }
        foreach(var start in new[]{AppDomain.CurrentDomain.BaseDirectory,Directory.GetCurrentDirectory(),installParent}.Where(Directory.Exists)){
            var parent=new DirectoryInfo(start);
            while(parent!=null){paths.Add(At(parent.FullName,"node_modules"));parent=parent.Parent;}
        }
        string profile=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach(var area in new[]{@"source\repos","Projects","Developer",@"Documents\GitHub"}){
            foreach(var dir in Directories(At(profile,area),"*"))paths.Add(At(dir,"node_modules"));
        }
        return paths.Where(Directory.Exists).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
    internal static bool HasWebView(){
        foreach(var hive in new[]{RegistryHive.CurrentUser,RegistryHive.LocalMachine})foreach(var view in new[]{RegistryView.Registry32,RegistryView.Registry64})
        using(var root=RegistryKey.OpenBaseKey(hive,view))using(var clients=root.OpenSubKey(@"SOFTWARE\Microsoft\EdgeUpdate\Clients")){
            if(clients==null)continue;
            foreach(var name in clients.GetSubKeyNames())using(var key=clients.OpenSubKey(name)){
                string title=Convert.ToString(key.GetValue("name"));string version=Convert.ToString(key.GetValue("pv"));
                if(title.IndexOf("WebView2",StringComparison.OrdinalIgnoreCase)>=0 && version.Length>0 && version!="0.0.0.0")return true;
            }
        }
        return false;
    }
    static void DownloadFile(string url,string path){ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;using(var w=new WebClient())w.DownloadFile(url,path);}
    static string Digest(string path){using(var sha=SHA256.Create())using(var input=File.OpenRead(path))return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();}
    static bool SameOrBelow(string location,string parent){
        string dir=Path.GetFullPath(parent).TrimEnd('\\');
        string path=Path.GetFullPath(location).TrimEnd('\\');
        return path.Equals(dir,StringComparison.OrdinalIgnoreCase)||path.StartsWith(dir+"\\",StringComparison.OrdinalIgnoreCase);
    }
    internal static string SharedRoot(Dictionary<string,string> sources,string[] roots){
        return roots.FirstOrDefault(root=>sources.All(p=>p.Value!=null &&
            String.Equals(Path.GetFullPath(At(root,p.Key)),Path.GetFullPath(p.Value),StringComparison.OrdinalIgnoreCase)));
    }
    internal static Dictionary<string,string> PackagePlan(Dictionary<string,string> choices,string[] roots,string dest){
        var sources=new Dictionary<string,string>();
        foreach(var item in Versions){
            string selected;
            if(choices.TryGetValue(item.Key,out selected)){
                if(selected!=null && InstalledVersion(selected,item.Key)!=item.Value)throw new IOException("Check the selected folder for "+item.Key+".");
            }else{
                selected=roots.Select(root=>At(root,item.Key)).FirstOrDefault(dir=>InstalledVersion(dir,item.Key)==item.Value);
            }
            if(selected!=null && SameOrBelow(selected,dest))throw new IOException("Select a package outside the installation folder.");
            sources.Add(item.Key,selected);
        }
        return sources;
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
    static extern bool DefineDosDevice(uint flags,string name,string target);
    sealed class ShortStage:IDisposable {
        internal readonly string Physical;
        internal readonly string PathName;
        string drive;
        internal ShortStage(string parent){
            Physical=At(parent,".carnot-setup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Physical);
            PathName=Physical;
            // ZipFile and some npm tools still use traditional Win32 path limits.
            var used=Environment.GetLogicalDrives();
            foreach(char letter in "ZYXWVUTSRQP"){
                var name=letter+":";
                if(used.Contains(name+"\\",StringComparer.OrdinalIgnoreCase))continue;
                if(DefineDosDevice(8,name,Physical)){drive=name;PathName=name+@"\";break;}
            }
        }
        public void Dispose(){
            try{
                foreach(var dir in Directory.GetDirectories(PathName))Directory.Delete(dir,true);
                foreach(var file in Directory.GetFiles(PathName))File.Delete(file);
            }finally{
                if(drive!=null)DefineDosDevice(8|2|4,drive,Physical);
                if(!Directory.EnumerateFileSystemEntries(Physical).Any())Directory.Delete(Physical);
            }
        }
    }
    internal static void Install(string dest,string data,string node,Dictionary<string,string> choices,string[] roots,bool shortcut,bool map,Action<string> status){
        if(!Path.IsPathRooted(dest))throw new IOException("Choose an absolute installation path.");
        dest=Path.Combine(Path.GetFullPath(dest),Product);
        if(Path.GetDirectoryName(dest)==null || (Directory.Exists(dest)&&Directory.EnumerateFileSystemEntries(dest).Any(p=>!Directory.Exists(p)||!String.Equals(Path.GetFileName(p),"workspace",StringComparison.OrdinalIgnoreCase)||(File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)))throw new IOException("The Carnot Agent Engine subfolder already contains files. Choose another parent folder or uninstall the existing application.");
        if(data!="" && (!Path.IsPathRooted(data) || SameOrBelow(data,dest)))throw new IOException("Choose a workspace outside the application folder.");
        if(node!=Download && (!CompatibleNode(node)||SameOrBelow(node,dest)))throw new IOException("Select a compatible Windows x64 Node.js 24.19 or newer in the 24.x series.");
        var sources=PackagePlan(choices,roots,dest);
        string modules=SharedRoot(sources,roots);
        using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Carnot Agent Engine")){
          if(key!=null && File.Exists(Convert.ToString(key.GetValue("UninstallString")).Trim('"')))throw new IOException("Uninstall the existing Carnot desktop application before continuing.");
        }
        var storage=new ShortStage(Path.GetDirectoryName(dest));
        string stage=storage.PathName;
        Directory.CreateDirectory(stage);
        string owned=At(stage,"private");Directory.CreateDirectory(owned);
        File.WriteAllText(At(owned,".carnot-owned"),"Carnot desktop setup");
        string powershell=At(Environment.SystemDirectory,@"WindowsPowerShell\v1.0\powershell.exe");
        bool ownNode=node==Download,ownDeps=modules==null,started=false;
        try{
            if(ownNode){
                status("Downloading Node.js 24.21.0…");
                string zip=At(stage,"node.zip");
                DownloadFile("https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",zip);
                if(Digest(zip)!="158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541")throw new InvalidDataException("Node.js checksum verification failed.");
                ZipFile.ExtractToDirectory(zip,stage);
                node=At(stage,@"node-v24.21.0-win-x64\node.exe");
                Directory.CreateDirectory(At(owned,"node"));
                File.Copy(node,At(owned,@"node\node.exe"));File.Copy(At(Path.GetDirectoryName(node),"LICENSE"),At(owned,@"node\LICENSE"));
            }
            if(ownDeps){
                status("Preparing project dependencies…");
                Extract("packages.mjs",At(stage,"packages.mjs"));
                Extract("package-lock.json",At(stage,"package-lock.json"));
                File.WriteAllText(At(stage,"sources.json"),new JavaScriptSerializer().Serialize(sources));
                Run(node,Q(At(stage,"packages.mjs")),stage);
                modules=At(owned,@"packages\node_modules");
                if(!CompatibleModules(modules))throw new IOException("Project dependency validation failed.");
            }
            if(!HasWebView()){
                status("Installing Microsoft Edge WebView2…");
                string web=At(stage,"webview.exe");DownloadFile("https://go.microsoft.com/fwlink/p/?LinkId=2124703",web);
                Run(powershell,"-NoProfile -NonInteractive -Command \"$s=Get-AuthenticodeSignature -LiteralPath $env:CARNOT_WEB_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){exit 1}\"",stage,new Dictionary<string,string>{{"CARNOT_WEB_INSTALLER",web}});
                Run(web,"/silent /install",stage);if(!HasWebView())throw new IOException("WebView2 installation did not complete.");
            }
            status("Installing Carnot Agent Engine…");
            string core=At(stage,"carnot-core.exe");Extract("core.exe",core);
            started=true;Run(core,(shortcut?"/S /D=":"/S /NS /D=")+dest,stage);
            if(!File.Exists(At(dest,"carnot-desktop.exe")))throw new IOException("Carnot could not be installed in the selected folder.");
            if(ownNode||ownDeps)Directory.Move(At(storage.Physical,"private"),At(dest,"carnot-private-env"));
            if(ownNode)node=At(dest,@"carnot-private-env\node\node.exe");
            if(ownDeps)modules=At(dest,@"carnot-private-env\packages\node_modules");
            var linkVars=new Dictionary<string,string>{{"CARNOT_LINK",At(dest,@"payload\app\node_modules")},{"CARNOT_MODULES",modules}};
            Run(powershell,"-NoProfile -NonInteractive -Command \"$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:CARNOT_LINK -Target $env:CARNOT_MODULES | Out-Null\"",stage,linkVars);
            File.WriteAllBytes(At(dest,"node-path.txt"),System.Text.Encoding.Unicode.GetBytes(node));
            if(map)Extract("physics-map.js",At(dest,@"payload\app\dist\web\basic-physics-map.mjs"));
            var shortcutVars=new Dictionary<string,string>{{"CARNOT_APP_EXE",At(dest,"carnot-desktop.exe")},{"CARNOT_ICON",At(dest,"carnot-0.2.5.ico")}};
            string updateLinks="$shell=New-Object -ComObject WScript.Shell; foreach($dir in [Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('DesktopDirectory')){foreach($l in Get-ChildItem -LiteralPath $dir -Filter 'Carnot Agent Engine.lnk' -Recurse -File){$link=$shell.CreateShortcut($l.FullName);if($link.TargetPath -eq $env:CARNOT_APP_EXE){$link.IconLocation=$env:CARNOT_ICON+',0';$link.Save()}}}";
            Run(powershell,"-NoProfile -NonInteractive -Command "+Q(updateLinks),stage,shortcutVars);
            SHChangeNotify(0x08000000,0,IntPtr.Zero,IntPtr.Zero);
            if(data!="")File.WriteAllBytes(At(dest,"workspace-path.txt"),System.Text.Encoding.Unicode.GetBytes(Path.GetFullPath(data)));
        }catch{
            string uninstall=At(dest,"uninstall.exe");
            if(started&&File.Exists(uninstall))Run(uninstall,"/S",stage);
            throw;
        }finally{storage.Dispose();}
    }
}
