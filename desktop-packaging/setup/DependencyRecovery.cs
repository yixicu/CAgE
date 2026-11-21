using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// Runs independently of Node, so a missing runtime can be repaired before the backend starts.
internal static class DependencyRecovery {
    static string Choose(string label,string previous,Func<IEnumerable<string>> detect,Func<string,string> validate){
        string selected=null;
        Exception failure=null;
        var ui=new Thread(new ThreadStart(delegate {
            try {
                using(var form=new Form { Text="Locate "+label+" · Carnot Agent Engine",Width=650,Height=247,
                    StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false }){
                    var message=new Label {Left=16,Top=14,Width=600,Height=40,AutoEllipsis=true,
                        Text=label+" is missing or incompatible at its saved location.\n"+previous};
                    var paths=new ComboBox {Left=16,Top=62,Width=600,DropDownStyle=ComboBoxStyle.DropDown};
                    var scan=new Button {Left=16,Top=97,Width=135,Text="Detect on this device",AutoSize=true};
                    var browse=new Button {Left=163,Top=97,Width=105,Text="Browse…"};
                    var status=new Label {Left=16,Top=132,Width=600,Height=23};
                    var use=new Button {Left=410,Top=161,Width=112,Text="Use location"};
                    var cancel=new Button {Left=530,Top=161,Width=86,Text="Cancel",DialogResult=DialogResult.Cancel};
                    scan.Click+=(s,e)=>{
                        paths.Items.Clear();
                        foreach(var candidate in detect().Select(validate).Where(p=>p!=null).Distinct(StringComparer.OrdinalIgnoreCase))paths.Items.Add(candidate);
                        if(paths.Items.Count>0)paths.SelectedIndex=0;
                        status.Text=paths.Items.Count>0?"Confirm a location to continue.":"No compatible location found. Browse or paste a path.";
                    };
                    browse.Click+=(s,e)=>{using(var picker=new FolderBrowserDialog {Description="Choose the folder containing "+label, ShowNewFolderButton=false}){
                        if(picker.ShowDialog(form)==DialogResult.OK)paths.Text=picker.SelectedPath;
                    }};
                    use.Click+=(s,e)=>{selected=validate(paths.Text.Trim().Trim('"'));
                        if(selected==null)status.Text="This location does not contain a compatible "+label+".";
                        else form.DialogResult=DialogResult.OK;
                    };
                    form.AcceptButton=use;form.CancelButton=cancel;
                    form.Controls.AddRange(new Control[]{message,paths,scan,browse,status,use,cancel});form.ShowDialog();
                }
            }catch(Exception e){failure=e;}
        }));
        ui.SetApartmentState(ApartmentState.STA);ui.Start();ui.Join();
        if(failure!=null)throw new IOException("Could not open dependency recovery.",failure);
        if(selected==null)throw new OperationCanceledException("Dependency selection cancelled.");
        return selected;
    }

    static string[] InstalledDependencies(string app){
        var parser=new System.Web.Script.Serialization.JavaScriptSerializer();
        var manifest=parser.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(app,"package.json")));
        return ((Dictionary<string,object>)manifest["dependencies"]).Keys.ToArray();
    }

    internal static string Resolve(string root,bool updating){
        var setting=Path.Combine(root,"node-path.txt");
        string saved=File.Exists(setting)?Encoding.Unicode.GetString(File.ReadAllBytes(setting)):null;
        string node=saved;
        if(String.IsNullOrWhiteSpace(node)||!Path.IsPathRooted(node)||!SetupEnvironment.CompatibleNode(node)){
            var privateNode=Path.Combine(root,@"carnot-private-env\node\node.exe");
            node=Choose("Node.js",saved??setting,()=>new[]{privateNode,Path.Combine(root,@"payload\runtime\node.exe")}.Concat(SetupEnvironment.Nodes()),p=>{
                if(String.IsNullOrWhiteSpace(p)||p.IndexOfAny(Path.GetInvalidPathChars())>=0||!Path.IsPathRooted(p))return null;
                if(Directory.Exists(p))p=Path.Combine(p,"node.exe");
                return String.Equals(Path.GetFileName(p),"node.exe",StringComparison.OrdinalIgnoreCase)&&SetupEnvironment.CompatibleNode(p)?Path.GetFullPath(p):null;
            });
        }
        var app=Path.Combine(root,@"payload\app");
        var link=Path.Combine(app,"node_modules");
        // An upgrade can reuse an older tree and fetch changed versions in PrepareModules.
        var existing=updating ? InstalledDependencies(app) : SetupEnvironment.Direct;
        bool present=updating ? existing.Any(name=>File.Exists(Path.Combine(link,name,"package.json"))) : SetupEnvironment.CompatibleModules(link);
        if(!present){
            Func<string,string> validate=p=>{
                if(String.IsNullOrWhiteSpace(p)||p.IndexOfAny(Path.GetInvalidPathChars())>=0||!Path.IsPathRooted(p))return null;
                foreach(var dir in new[]{p,Path.Combine(p,"node_modules")}.Where(Directory.Exists)){
                    var full=Path.GetFullPath(dir).TrimEnd('\\');
                    if(String.Equals(full,link,StringComparison.OrdinalIgnoreCase)||full.StartsWith(link+"\\",StringComparison.OrdinalIgnoreCase))continue;
                    if(updating ? existing.All(name=>SetupEnvironment.InstalledVersion(Path.Combine(full,name),name)!=null)
                                : SetupEnvironment.CompatibleModules(full))return full;
                }
                return null;
            };
            var previous=SetupEnvironment.Run(node,"-e \"try{process.stdout.write(require('fs').readlinkSync('node_modules'))}catch{}\"",app);
            var modules=Choose("node_modules",String.IsNullOrEmpty(previous)?link:previous,()=>new[]{Path.Combine(root,@"carnot-private-env\packages\node_modules")}.Concat(SetupEnvironment.Modules(root)),validate);
            var helper=Path.Combine(app,".carnot-relink-"+Guid.NewGuid().ToString("N")+".cjs");
            try{
                SetupEnvironment.Extract("relink-modules.cjs",helper);
                SetupEnvironment.Run(node,"\""+helper+"\"",app,new Dictionary<string,string>{{"CARNOT_RECOVERY_MODULES",modules}});
            }finally{if(File.Exists(helper))File.Delete(helper);}
        }
        if(node!=saved){
            var tmp=setting+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{
                File.WriteAllBytes(tmp,Encoding.Unicode.GetBytes(node));
                if(File.Exists(setting))File.Replace(tmp,setting,null);
                else File.Move(tmp,setting);
            }finally{if(File.Exists(tmp))File.Delete(tmp);}
        }
        return node;
    }

    [STAThread] public static int Main(){
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
        try{
            var root=Environment.CurrentDirectory;
            using(new FileStream(Path.Combine(root,".carnot-updating.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None,1,FileOptions.DeleteOnClose)){
                Resolve(root,false);
            }
            return 0;
        }catch(OperationCanceledException){return 2;}
        catch(Exception e){MessageBox.Show(e.Message,"Carnot dependency recovery");return 1;}
    }
}
