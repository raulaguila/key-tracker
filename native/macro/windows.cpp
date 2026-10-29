// Explicit pointer playback. Fixed numeric protocol, no shell or text input.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
static void result(int id, bool ok, bool released=false, const char* code="MACRO_UNAVAILABLE") {
 std::cout << "{\"type\":\"result\",\"id\":" << id << ",\"ok\":" << (ok?"true":"false") << ",\"released\":" << (released?"true":"false") << ",\"code\":\"" << code << "\"}" << std::endl;
}
int main(int argc,char** argv) {
 if(argc==2&&std::string(argv[1])=="--self-test"){std::cout<<"{\"selfTest\":true,\"backend\":\"SendInput\"}"<<std::endl;return 0;}
 if(argc!=1)return 2;
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
 std::cout << "{\"type\":\"ready\"}" << std::endl;
 std::string line;
 while(std::getline(std::cin,line)) {
  if(line.size()>256)return 2;
  std::istringstream in(line);int id=0;std::string command,extra;
  if(!(in>>id>>command)||id<1)return 2;
  if(command=="released") {
   if(in>>extra)return 2;
   bool released=true;for(int key=1;key<256;key++)if(GetAsyncKeyState(key)&0x8000){released=false;break;}
   result(id,true,released);continue;
  }
  int x,y,button,clicks;
  if(command!="click"||!(in>>x>>y>>button>>clicks)||(in>>extra)||x < -100000||x > 100000||y < -100000||y > 100000||button<1||button>3||clicks<1||clicks>2)return 2;
  const int left=GetSystemMetrics(SM_XVIRTUALSCREEN), top=GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width=GetSystemMetrics(SM_CXVIRTUALSCREEN),height=GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if(width<2||height<2||x<left||x>=left+width||y<top||y>=top+height){result(id,false,false,"MACRO_COORDINATES");continue;}
  INPUT move={};move.type=INPUT_MOUSE;move.mi.dx=MulDiv(x-left,65535,width-1);move.mi.dy=MulDiv(y-top,65535,height-1);move.mi.dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_VIRTUALDESK;
  bool ok=SendInput(1,&move,sizeof(INPUT))==1;
  DWORD down=button==1?MOUSEEVENTF_LEFTDOWN:button==2?MOUSEEVENTF_MIDDLEDOWN:MOUSEEVENTF_RIGHTDOWN;
  DWORD up=button==1?MOUSEEVENTF_LEFTUP:button==2?MOUSEEVENTF_MIDDLEUP:MOUSEEVENTF_RIGHTUP;
  for(int i=0;i<clicks&&ok;i++) {
   INPUT events[2]={};events[0].type=events[1].type=INPUT_MOUSE;events[0].mi.dwFlags=down;events[1].mi.dwFlags=up;
   UINT sent=SendInput(2,events,sizeof(INPUT));ok=sent==2;
   if(sent==1)SendInput(1,&events[1],sizeof(INPUT));
  }
  result(id,ok);
 }
 return 0;
}
