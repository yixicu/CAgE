using System;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media.Imaging;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Windows.Automation;
using Forms=System.Windows.Forms;

internal class Setup {
    Window window;
    bool busy,done,web,detecting;
    T UI<T>(string name) where T:class {return window.FindName(name) as T;}
    ComboBox Node {get{return UI<ComboBox>("Node");}}
    const string Fresh="Install this fresh";
    sealed class Candidate {
        internal string Name,Selected;
        internal string[] Paths;
        internal bool Incompatible;
    }
    readonly List<Candidate> selections=new List<Candidate>();
    readonly List<string> roots=new List<string>();
    void Status(string text){window.Dispatcher.Invoke(new Action(()=>UI<TextBlock>("Status").Text=text));}
    static string PickFolder(string prompt){
        using(var d=new Forms.FolderBrowserDialog{Description=prompt,ShowNewFolderButton=true})
            return d.ShowDialog()==Forms.DialogResult.OK?d.SelectedPath:null;
    }
    static void AddChoice(ComboBox box,string path){if(!box.Items.Contains(path))box.Items.Insert(0,path);box.SelectedItem=path;}
    bool Have(string id){return UI<RadioButton>("Have"+id).IsChecked==true;}
    void Plan(){
        foreach(string id in new[]{"Node","Modules"})
            UI<StackPanel>(id+"Row").Visibility=Have(id)?Visibility.Visible:Visibility.Collapsed;
        var downloads=new List<string>();
        if(!Have("Node")||Node.SelectedItem==null||(string)Node.SelectedItem==Fresh)downloads.Add("Node.js");
        int count=Have("Modules")&&selections.Count!=0?selections.Count(c=>c.Selected==null):SetupEnvironment.Versions.Count;
        if(count!=0)downloads.Add(count+(count==1?" package":" packages"));
        if(!web)downloads.Add("Microsoft Edge WebView2");
        UI<TextBlock>("Plan").Text=downloads.Count==0?"":("Downloads on Install: "+String.Join(", ",downloads));
    }
    void SelectPackage(string name,ComboBox box){
        var dir=PickFolder("Choose "+name+" or its node_modules folder");
        if(dir==null)return;
        string selected=new[]{dir,Path.Combine(dir,name),Path.Combine(dir,"node_modules",name)}.FirstOrDefault(path=>SetupEnvironment.InstalledVersion(path,name)==SetupEnvironment.Versions[name]);
        if(selected==null){Status("Choose "+name+" "+SetupEnvironment.Versions[name]+".");return;}
        AddChoice(box,selected);
        var parent=new DirectoryInfo(selected);
        while(parent!=null&&!parent.Name.Equals("node_modules",StringComparison.OrdinalIgnoreCase))parent=parent.Parent;
        if(parent!=null&&!roots.Contains(parent.FullName))roots.Add(parent.FullName);
        Status("");
    }
    void PackageRow(StackPanel panel,Candidate item){
        string name=item.Name;
        var title=new TextBlock{Text=name+" "+SetupEnvironment.Versions[name],Margin=new Thickness(0,8,0,2)};
        panel.Children.Add(title);
        var row=new DockPanel();
        panel.Children.Add(row);
        var button=new Button{Style=(Style)window.FindResource("Folder"),ToolTip="Choose folder for "+name};
        AutomationProperties.SetName(button,(string)button.ToolTip);
        DockPanel.SetDock(button,Dock.Right);row.Children.Add(button);
        var box=new ComboBox();
        AutomationProperties.SetName(box,name+" installation");AutomationProperties.SetAutomationId(box,"Package_"+name);
        foreach(string candidate in item.Paths)box.Items.Add(candidate);
        box.Items.Add(Fresh);box.SelectedIndex=0;
        row.Children.Add(box);
        var reason=item.Paths.Length!=0?null:item.Incompatible?"Incompatible version":"Missing";
        Action update=()=>title.Text=name+" "+SetupEnvironment.Versions[name]+((string)box.SelectedItem==Fresh?" · "+(reason==null?"":reason+" · ")+"Downloads on Install":"");
        box.SelectionChanged+=(a,b)=>{item.Selected=(string)box.SelectedItem==Fresh?null:(string)box.SelectedItem;update();Plan();};button.Click+=(a,b)=>SelectPackage(name,box);update();
    }
    void ShowGroup(string label,Candidate[] group){
        var panel=UI<StackPanel>("PackageRows");
        panel.Children.Add(new TextBlock{Text=label+" ("+group.Length+")",FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,12,0,0)});
        foreach(var item in group.Where(c=>SetupEnvironment.Direct.Contains(c.Name)))PackageRow(panel,item);
        var transitive=group.Where(c=>!SetupEnvironment.Direct.Contains(c.Name)).ToArray();
        if(transitive.Length==0)return;
        var rows=new StackPanel();
        var extra=new Expander{Header="Transitive dependencies ("+transitive.Length+")",Content=rows,Margin=new Thickness(0,6,0,0)};
        extra.Expanded+=(a,b)=>{if(rows.Children.Count==0)foreach(var item in transitive)PackageRow(rows,item);};
        panel.Children.Add(extra);
    }
    async void Start(){
        if(done){window.Close();return;}if(busy)return;
        var dest=UI<TextBox>("InstallPath").Text.Trim();var data=UI<TextBox>("DataPath").Text.Trim();
        if(detecting)return;
        if(Have("Modules")&&selections.Count==0){Discover("Modules");return;}
        string node=Have("Node")?(string)Node.SelectedItem:null;
        if(node==null||node==Fresh)node=SetupEnvironment.Download;
        var choices=Have("Modules")?selections.ToDictionary(c=>c.Name,c=>c.Selected):new Dictionary<string,string>();
        string[] search=Have("Modules")?roots.ToArray():new string[0];
        bool shortcut=UI<CheckBox>("Shortcut").IsChecked==true,map=UI<CheckBox>("BasicMap").IsChecked==true;
        busy=true;Toggle(false);Status("Preparing installation…");UI<ProgressBar>("Progress").Visibility=Visibility.Visible;
        try{await Task.Run(()=>SetupEnvironment.Install(dest,data,node,choices,search,shortcut,map,Status));
            done=true;UI<Button>("Go").Content="Finish";Status("Installed. Open Carnot Agent Engine from the Start menu.");
        }catch(Exception e){Status("Installation could not finish.");MessageBox.Show(window,e.Message,"Carnot setup",MessageBoxButton.OK,MessageBoxImage.Warning);}
        finally{busy=false;Toggle(!done);UI<Button>("Go").IsEnabled=true;UI<ProgressBar>("Progress").Visibility=Visibility.Collapsed;}
    }
    void Toggle(bool enabled){UI<Expander>("Advanced").IsEnabled=enabled;UI<CheckBox>("Shortcut").IsEnabled=enabled;UI<StackPanel>("Locations").IsEnabled=enabled;UI<Button>("Go").IsEnabled=enabled;}
    async void Discover(string id){
        if(detecting||busy)return;
        detecting=true;
        Toggle(false);
        try{
            if(id=="Node"){
                var paths=await Task.Run(()=>SetupEnvironment.Nodes().ToArray());
                foreach(string path in paths)if(!Node.Items.Contains(path))Node.Items.Insert(Node.Items.Count-1,path);
                Node.SelectedIndex=0;
                UI<TextBlock>("NodeResult").Text=paths.Length==0?"No compatible Node.js found. Downloads on Install.":"";
            }else{
                var installParent=UI<TextBox>("InstallPath").Text.Trim();
                var found=await Task.Run(()=>SetupEnvironment.Modules(installParent).ToArray());
                foreach(var path in found)if(!roots.Contains(path,StringComparer.OrdinalIgnoreCase))roots.Add(path);
                var matches=await Task.Run(()=>SetupEnvironment.Versions.Keys.ToDictionary(name=>name,name=>
                    roots.Select(root=>Path.Combine(root,name)).Where(Directory.Exists)
                    .ToDictionary(path=>path,path=>SetupEnvironment.InstalledVersion(path,name),StringComparer.OrdinalIgnoreCase)));
                foreach(var name in SetupEnvironment.Versions.Keys){
                    var paths=matches[name].Where(pair=>pair.Value==SetupEnvironment.Versions[name]).Select(pair=>pair.Key).ToArray();
                    selections.Add(new Candidate{Name=name,Paths=paths,Selected=paths.FirstOrDefault(),Incompatible=matches[name].Count!=0});
                }
                ShowGroup("Missing or incompatible · download on Install",selections.Where(c=>c.Selected==null).ToArray());
                ShowGroup("Compatible on this device",selections.Where(c=>c.Selected!=null).ToArray());
                Plan();
                UI<Button>("DetectModules").Visibility=Visibility.Collapsed;
            }
        }catch(Exception e){Status(e.Message);}finally{detecting=false;Toggle(true);}
    }
    void Open(){
        using(var stream=SetupEnvironment.Resource("Setup.xaml"))window=(Window)XamlReader.Load(stream);
        using(var s=SetupEnvironment.Resource("mark.png")){
            var img=new BitmapImage();img.BeginInit();img.CacheOption=BitmapCacheOption.OnLoad;img.StreamSource=s;img.DecodePixelWidth=128;img.EndInit();img.Freeze();UI<Image>("Mark").Source=img;window.Icon=img;
        }
        UI<TextBox>("InstallPath").Text=SetupEnvironment.DefaultInstall;
        UI<Button>("PickInstall").Click+=(a,b)=>{var dir=PickFolder("Choose the application folder");if(dir!=null)UI<TextBox>("InstallPath").Text=dir;};
        UI<Button>("PickData").Click+=(a,b)=>{var dir=PickFolder("Choose a Carnot workspace");if(dir!=null)UI<TextBox>("DataPath").Text=dir;};
        UI<Button>("PickNode").Click+=(a,b)=>{
            var dir=PickFolder("Choose the folder containing node.exe");
            if(dir==null)return;
            var path=Path.Combine(dir,"node.exe");
            if(SetupEnvironment.CompatibleNode(path)){AddChoice(Node,path);UI<TextBlock>("NodeResult").Text="";}
            else UI<TextBlock>("NodeResult").Text="Choose Windows x64 Node.js 24.19 or later in the 24.x series.";
        };
        Node.Items.Add(Fresh);Node.SelectedIndex=0;
        UI<Button>("DetectNode").Click+=(a,b)=>Discover("Node");
        UI<Button>("DetectModules").Click+=(a,b)=>Discover("Modules");
        string direct=String.Join("\n",SetupEnvironment.Direct.Select(p=>p+"  "+SetupEnvironment.Versions[p]));
        var info=UI<Button>("Info");
        info.ToolTip=new ToolTip{Content=direct,Placement=System.Windows.Controls.Primitives.PlacementMode.Top,
            Background=System.Windows.Media.Brushes.White,Foreground=System.Windows.Media.Brushes.Black,Padding=new Thickness(12,8,12,8)};
        info.Click+=(a,b)=>{
            var list=new TextBox{Text=String.Join(Environment.NewLine,SetupEnvironment.Packages.Select(p=>p.Replace('\t',' '))),IsReadOnly=true,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Auto,Margin=new Thickness(12)};
            new Window{Title="Required dependency versions",Owner=window,WindowStartupLocation=WindowStartupLocation.CenterOwner,Width=550,Height=500,Content=list}.ShowDialog();
        };
        UI<Button>("Go").Click+=(a,b)=>Start();window.Closing+=(a,b)=>{if(busy)b.Cancel=true;};
        web=SetupEnvironment.HasWebView();Plan();Node.SelectionChanged+=(a,b)=>Plan();
        foreach(string id in new[]{"Node","Modules"})foreach(string prefix in new[]{"Have","New"})UI<RadioButton>(prefix+id).Checked+=(a,b)=>Plan();
        new Application().Run(window);
    }
    static int OpenUpdate(Upgrade.Installed installed,bool automatic){
        if(installed.Version>Upgrade.Target)throw new IOException("A newer version of Carnot Agent Engine is already installed.");
        var window=new Window{Title="Update Carnot Agent Engine",Width=510,SizeToContent=SizeToContent.Height,ResizeMode=ResizeMode.NoResize,WindowStartupLocation=WindowStartupLocation.CenterScreen};
        var panel=new StackPanel{Margin=new Thickness(24)};window.Content=panel;
        panel.Children.Add(new TextBlock{Text="Carnot Agent Engine "+Upgrade.Target,FontSize=22,FontWeight=FontWeights.SemiBold});
        var status=new TextBlock{Text=installed.Version==Upgrade.Target?"This version is installed.":("Update version "+installed.Version+" in "+installed.Root+". Close Carnot before continuing."),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,12,0,16)};
        panel.Children.Add(status);
        var progress=new ProgressBar{IsIndeterminate=true,Height=4,Visibility=Visibility.Collapsed,Margin=new Thickness(0,0,0,12)};panel.Children.Add(progress);
        var action=new Button{Content=installed.Version==Upgrade.Target?"Finish":"Update",Padding=new Thickness(16,6,16,6),HorizontalAlignment=HorizontalAlignment.Right,IsDefault=true};panel.Children.Add(action);
        bool running=false;int result=1;
        Func<Task> update=async delegate{
            if(running)return;
            running=true;action.IsEnabled=false;progress.Visibility=Visibility.Visible;
            try{
                await Task.Run(()=>Upgrade.Apply(installed,text=>window.Dispatcher.Invoke(new Action(()=>status.Text=text))));
                if(automatic||installed.Version<Upgrade.Target)
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Path.Combine(installed.Root,"carnot-desktop.exe")){WorkingDirectory=installed.Root});
                result=0;running=false;window.Close();
            }catch(Exception ex){status.Text=ex.Message;action.Content="Retry";}
            finally{running=false;action.IsEnabled=true;progress.Visibility=Visibility.Collapsed;}
        };
        action.Click+=async (a,b)=>await update();
        if(automatic)window.ContentRendered+=async (a,b)=>await update();
        window.Closing+=(a,b)=>{if(running)b.Cancel=true;};
        new Application().Run(window);return result;
    }
    [STAThread] public static int Main(string[] args){
        System.Globalization.CultureInfo.DefaultThreadCurrentUICulture=new System.Globalization.CultureInfo("en-US");
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
        try{
            bool update=args.Length==1&&args[0]=="--update";
            if(args.Length!=0&&!update)throw new ArgumentException("Run setup without arguments to install, or use --update for the registered installation.");
            var installed=Upgrade.Find();
            if(installed!=null)return OpenUpdate(installed,update);
            if(update)throw new IOException("No registered Carnot Agent Engine installation was found for this Windows account.");
            new Setup().Open();return 0;
        }catch(Exception e){MessageBox.Show(e.Message,"Carnot setup");return 1;}
    }
}
