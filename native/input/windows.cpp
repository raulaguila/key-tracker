// Passive Raw Input receiver. No exclusive registration, grabs, injection or text conversion.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <thread>
static HWND receiver;
static std::map<HANDLE,std::string> identities;
static long long tick(){LARGE_INTEGER counter,frequency;QueryPerformanceCounter(&counter);QueryPerformanceFrequency(&frequency);return (long long)((double)counter.QuadPart*1000.0/(double)frequency.QuadPart);}
static std::string utf8(const std::wstring& s){int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string r(n,' ');if(n)WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),r.data(),n,nullptr,nullptr);return r;}
static std::string quote(const std::string& s){std::string r="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){r+='\\';r+=c;}else if(c>=32)r+=c;}return r+'"';}
static void emit(const std::string& s){std::cout<<s<<std::endl;if(!std::cout)PostQuitMessage(1);}
static bool devices(){
 UINT count=0;if(GetRawInputDeviceList(nullptr,&count,sizeof(RAWINPUTDEVICELIST))==(UINT)-1 || count>1024)return false;
 std::vector<RAWINPUTDEVICELIST> list(count);if(count && GetRawInputDeviceList(list.data(),&count,sizeof(RAWINPUTDEVICELIST))==(UINT)-1)return false;
 identities.clear();std::string out="{\"type\":\"devices\",\"devices\":[";int found=0;
 for(UINT i=0;i<count;i++)if(list[i].dwType==RIM_TYPEKEYBOARD){
  UINT size=0;if(GetRawInputDeviceInfoW(list[i].hDevice,RIDI_DEVICENAME,nullptr,&size)==(UINT)-1||size>4096||!size)continue;
  std::wstring name(size,L'\0');if(GetRawInputDeviceInfoW(list[i].hDevice,RIDI_DEVICENAME,name.data(),&size)==(UINT)-1)continue;
  while(!name.empty()&&name.back()==L'\0')name.pop_back();
  std::string id=utf8(name);if(id.empty())continue;if(++found>32)return false;
  identities[list[i].hDevice]=id;
  if(found>1)out+=",";
  auto vid=id.find("VID_"),pid=id.find("PID_");
  std::string label="Teclado HID";
  if(vid!=std::string::npos && vid+8<=id.size())label+=" "+id.substr(vid,8);
  if(pid!=std::string::npos && pid+8<=id.size())label+=" "+id.substr(pid,8);
  label+=" · "+std::to_string(found);
  out+="{\"id\":"+quote(id)+",\"name\":"+quote(label)+"}";
 }
 emit(out+"]}");return true;
}
static LRESULT CALLBACK procedure(HWND window,UINT message,WPARAM w,LPARAM l){
 if(message==WM_INPUT_DEVICE_CHANGE){if(!devices()){emit("{\"type\":\"error\"}");PostQuitMessage(1);}return 0;}
 if(message==WM_INPUT){
  UINT size=0;if(GetRawInputData((HRAWINPUT)l,RID_INPUT,nullptr,&size,sizeof(RAWINPUTHEADER))==(UINT)-1||size>65536)return DefWindowProcW(window,message,w,l);
  std::vector<BYTE> data(size);if(GetRawInputData((HRAWINPUT)l,RID_INPUT,data.data(),&size,sizeof(RAWINPUTHEADER))!=size)return DefWindowProcW(window,message,w,l);
  auto input=reinterpret_cast<const RAWINPUT*>(data.data());
  if(input->header.dwType==RIM_TYPEKEYBOARD && identities.count(input->header.hDevice)){
   const auto& key=input->data.keyboard;
   if(key.MakeCode && key.MakeCode!=0xff && key.VKey!=255){
    emit("{\"type\":\"key\",\"device\":"+quote(identities[input->header.hDevice])+",\"code\":"+std::to_string(key.MakeCode)+",\"virtualKey\":"+std::to_string(key.VKey)+",\"down\":"+((key.Flags&RI_KEY_BREAK)?"false":"true")+",\"globallyDown\":"+((GetAsyncKeyState(key.VKey)&0x8000)?"true":"false")+",\"extended\":"+((key.Flags&RI_KEY_E0)?"true":"false")+",\"e1\":"+((key.Flags&RI_KEY_E1)?"true":"false")+",\"monotonicMs\":"+std::to_string(tick())+"}");
   }
  }
  return DefWindowProcW(window,message,w,l); // Required foreground Raw Input cleanup.
 }
 if(message==WM_CLOSE){DestroyWindow(window);return 0;}
 if(message==WM_DESTROY){PostQuitMessage(0);return 0;}
 return DefWindowProcW(window,message,w,l);
}
int main(int argc,char** argv){
 if(argc==2&&std::string(argv[1])=="--self-test"){std::cout<<"{\"backend\":\"RawInput\",\"passive\":true,\"selfTest\":true,\"monotonicMs\":"<<tick()<<"}"<<std::endl;return 0;}
 if(argc!=1)return 2;
 HINSTANCE instance=GetModuleHandleW(nullptr);WNDCLASSW cls={};cls.lpfnWndProc=procedure;cls.hInstance=instance;cls.lpszClassName=L"DobraPassiveInput";
 if(!RegisterClassW(&cls))return 1;
 receiver=CreateWindowExW(0,cls.lpszClassName,L"Dobra Input",0,0,0,0,0,HWND_MESSAGE,nullptr,instance,nullptr);if(!receiver)return 1;
 RAWINPUTDEVICE device={0x01,0x06,RIDEV_INPUTSINK|RIDEV_DEVNOTIFY,receiver};
 if(!RegisterRawInputDevices(&device,1,sizeof(device))||!devices())return 1;
 DWORD foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),nullptr);
 HKL layout=GetKeyboardLayout(foregroundThread);
 std::string baseline="{\"type\":\"baseline\",\"keys\":[";bool comma=false;
 for(int vk=1;vk<256;vk++)if(vk!=VK_SHIFT&&vk!=VK_CONTROL&&vk!=VK_MENU&&(GetAsyncKeyState(vk)&0x8000)){
  UINT scan=MapVirtualKeyExW(vk,MAPVK_VK_TO_VSC_EX,layout);if(!scan)continue;
  if(comma)baseline+=",";comma=true;
  baseline+="{\"code\":"+std::to_string(scan&255)+",\"virtualKey\":"+std::to_string(vk)+",\"extended\":"+((scan&0xff00)==0xe000?"true":"false")+",\"e1\":"+(vk==VK_PAUSE?"true":"false")+"}";
 }
 emit(baseline+"]}");
 emit("{\"type\":\"ready\",\"monotonicMs\":"+std::to_string(tick())+"}");
 // EOF means the owning GUI exited; no detached keyboard observer survives it.
 std::thread([]{std::string line;while(std::getline(std::cin,line)){}PostMessageW(receiver,WM_CLOSE,0,0);}).detach();
 MSG message;while(GetMessageW(&message,nullptr,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}return 0;
}
