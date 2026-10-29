// Explicit pointer playback. Accessibility is requested by the GUI before use.
#include <ApplicationServices/ApplicationServices.h>
#include <iostream>
#include <sstream>
#include <string>
static void result(int id,bool ok,bool released=false,const char* code="MACRO_UNAVAILABLE"){std::cout<<"{\"type\":\"result\",\"id\":"<<id<<",\"ok\":"<<(ok?"true":"false")<<",\"released\":"<<(released?"true":"false")<<",\"code\":\""<<code<<"\"}"<<std::endl;}
int main(int argc,char** argv){
 if(argc==2&&std::string(argv[1])=="--self-test"){std::cout<<"{\"selfTest\":true,\"backend\":\"Quartz\"}"<<std::endl;return 0;}
 const bool authorize=argc==2&&std::string(argv[1])=="--authorize";
 if(argc!=1&&!authorize)return 2;
 if(authorize&&!CGPreflightPostEventAccess())CGRequestPostEventAccess();
 if(!CGPreflightPostEventAccess()){std::cout<<"{\"type\":\"error\",\"code\":\"MACRO_PERMISSION\"}"<<std::endl;return 1;}
 std::cout<<"{\"type\":\"ready\"}"<<std::endl;
 std::string line;
 while(std::getline(std::cin,line)){
  if(line.size()>256)return 2;
  std::istringstream in(line);int id=0;std::string command,extra;
  if(!(in>>id>>command)||id<1)return 2;
  if(command=="released"){
   if(in>>extra)return 2;
   bool released=true;for(int key=0;key<128;key++)if(CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState,(CGKeyCode)key)){released=false;break;}
   for(int button=0;button<3;button++)if(CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState,(CGMouseButton)button))released=false;
   result(id,true,released);continue;
  }
  int x,y,button,clicks;
  if(command!="click"||!(in>>x>>y>>button>>clicks)||(in>>extra)||x < -100000||x > 100000||y < -100000||y > 100000||button<1||button>3||clicks<1||clicks>2)return 2;
  if(!CGPreflightPostEventAccess()){result(id,false,false,"MACRO_PERMISSION");continue;}
  CGPoint point=CGPointMake(x,y);CGMouseButton nativeButton=button==1?kCGMouseButtonLeft:button==2?kCGMouseButtonCenter:kCGMouseButtonRight;
  CGDirectDisplayID display;uint32_t count=0;
  if(CGGetDisplaysWithPoint(point,1,&display,&count)!=kCGErrorSuccess||!count){result(id,false,false,"MACRO_COORDINATES");continue;}
  CGEventType down=button==1?kCGEventLeftMouseDown:button==3?kCGEventRightMouseDown:kCGEventOtherMouseDown;
  CGEventType up=button==1?kCGEventLeftMouseUp:button==3?kCGEventRightMouseUp:kCGEventOtherMouseUp;
  bool ok=true;
  for(int i=1;i<=clicks;i++){
   CGEventRef a=CGEventCreateMouseEvent(nullptr,down,point,nativeButton),b=CGEventCreateMouseEvent(nullptr,up,point,nativeButton);
   if(!a||!b){if(a)CFRelease(a);if(b)CFRelease(b);ok=false;break;}
   CGEventSetIntegerValueField(a,kCGMouseEventClickState,i);CGEventSetIntegerValueField(b,kCGMouseEventClickState,i);
   CGEventPost(kCGHIDEventTap,a);CGEventPost(kCGHIDEventTap,b);CFRelease(a);CFRelease(b);
  }
  result(id,ok);
 }
 return 0;
}
