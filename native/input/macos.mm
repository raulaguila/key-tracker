// Passive IOHID keyboard listener; requires Input Monitoring, never seizes devices.
#include <IOKit/hid/IOHIDManager.h>
#include <IOKit/hid/IOHIDLib.h>
#include <IOKit/hidsystem/IOHIDLib.h>
#include <CoreFoundation/CoreFoundation.h>
#include <iostream>
#include <string>
#include <map>
#include <set>
#include <vector>
#include <mach/mach_time.h>
#include <thread>
static IOHIDManagerRef manager;
static CFRunLoopRef runloop;
static std::map<IOHIDDeviceRef,std::string> identities;
static long long tick(){static mach_timebase_info_data_t timebase={0,0};if(!timebase.denom)mach_timebase_info(&timebase);return (long long)((double)mach_continuous_time()*(double)timebase.numer/(double)timebase.denom/1000000.0);}
static std::string quote(const std::string& s){std::string r="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){r+='\\';r+=c;}else if(c>=32)r+=c;}return r+'"';}
static void emit(const std::string& s){std::cout<<s<<std::endl;if(!std::cout)CFRunLoopStop(runloop);}
static std::string property(IOHIDDeviceRef d,CFStringRef key){
 CFTypeRef v=IOHIDDeviceGetProperty(d,key);if(!v)return "";
 if(CFGetTypeID(v)==CFStringGetTypeID()){char buffer[2048];if(CFStringGetCString((CFStringRef)v,buffer,sizeof(buffer),kCFStringEncodingUTF8))return buffer;}
 if(CFGetTypeID(v)==CFNumberGetTypeID()){long long number=0;if(CFNumberGetValue((CFNumberRef)v,kCFNumberLongLongType,&number))return std::to_string(number);}
 return "";
}
static std::string identity(IOHIDDeviceRef device){
 const auto location=property(device,CFSTR(kIOHIDLocationIDKey)), serial=property(device,CFSTR(kIOHIDSerialNumberKey));
 if(location.empty()&&serial.empty())return ""; // No invented identity for indistinguishable devices.
 return property(device,CFSTR(kIOHIDTransportKey))+":"+property(device,CFSTR(kIOHIDVendorIDKey))+":"+property(device,CFSTR(kIOHIDProductIDKey))+":"+location+":"+serial;
}
static void list(){
 std::string out="{\"type\":\"devices\",\"devices\":[";bool comma=false;
 for(const auto& item:identities){if(comma)out+=",";comma=true;auto name=property(item.first,CFSTR(kIOHIDProductKey));if(name.empty())name="Teclado HID";if(name.size()>256)name=name.substr(0,250);out+="{\"id\":"+quote(item.second)+",\"name\":"+quote(name)+"}";}
 emit(out+"]}");
}
static bool baseline(IOHIDDeviceRef device){
 CFArrayRef elements=IOHIDDeviceCopyMatchingElements(device,nullptr,kIOHIDOptionsTypeNone);if(!elements)return false;
 CFIndex count=CFArrayGetCount(elements);if(count>4096){CFRelease(elements);return false;}
 std::string out="{\"type\":\"baseline\",\"device\":"+quote(identities[device])+",\"keys\":[";bool comma=false;
 for(CFIndex i=0;i<count;i++){
  auto element=(IOHIDElementRef)CFArrayGetValueAtIndex(elements,i);auto usage=IOHIDElementGetUsage(element);
  if(IOHIDElementGetUsagePage(element)!=7||usage<4||usage>231||(IOHIDElementGetType(element)<kIOHIDElementTypeInput_Misc||IOHIDElementGetType(element)>kIOHIDElementTypeInput_ScanCodes))continue;
  IOHIDValueRef value=nullptr;
  if(IOHIDDeviceGetValue(device,element,&value)!=kIOReturnSuccess||!value){CFRelease(elements);return false;}
  if(IOHIDValueGetIntegerValue(value)){if(comma)out+=",";comma=true;out+="{\"code\":"+std::to_string(usage)+"}";}
 }
 CFRelease(elements);emit(out+"]}");return true;
}
static void added(void*,IOReturn result,void*,IOHIDDeviceRef device){
 if(result!=kIOReturnSuccess||identities.count(device))return;const auto id=identity(device);if(id.empty())return;
 for(const auto& item:identities)if(item.second==id&&item.first!=device){emit("{\"type\":\"error\"}");CFRunLoopStop(runloop);return;}
 if(identities.size()>=32){emit("{\"type\":\"error\"}");CFRunLoopStop(runloop);return;}
 identities[device]=id;list();if(!baseline(device)){emit("{\"type\":\"error\"}");CFRunLoopStop(runloop);}
}
static void removed(void*,IOReturn,void*,IOHIDDeviceRef device){identities.erase(device);list();}
static void input(void*,IOReturn result,void*,IOHIDValueRef value){
 if(result!=kIOReturnSuccess)return;IOHIDElementRef element=IOHIDValueGetElement(value);
 if(IOHIDElementGetUsagePage(element)!=0x07)return;
 IOHIDDeviceRef device=IOHIDElementGetDevice(element);if(!identities.count(device))return;
 const auto usage=IOHIDElementGetUsage(element);if(usage<4||usage>231)return;
 emit("{\"type\":\"key\",\"device\":"+quote(identities[device])+",\"code\":"+std::to_string(usage)+",\"down\":"+(IOHIDValueGetIntegerValue(value)?"true":"false")+",\"monotonicMs\":"+std::to_string(tick())+"}");
}
int main(int argc,char** argv){
 if(argc==2&&std::string(argv[1])=="--self-test"){std::cout<<"{\"backend\":\"IOHID\",\"passive\":true,\"selfTest\":true,\"monotonicMs\":"<<tick()<<"}"<<std::endl;return 0;}
 if(argc==2&&std::string(argv[1])=="--check-permission"){std::cout<<"{\"granted\":"<<(IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)==kIOHIDAccessTypeGranted?"true":"false")<<"}"<<std::endl;return 0;}
 if(argc!=1)return 2;
 if(IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)!=kIOHIDAccessTypeGranted && !IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)){emit("{\"type\":\"error\"}");return 1;}
 runloop=CFRunLoopGetCurrent();manager=IOHIDManagerCreate(kCFAllocatorDefault,kIOHIDOptionsTypeNone);if(!manager)return 1;
 int page=1,usage=6;CFNumberRef p=CFNumberCreate(nullptr,kCFNumberIntType,&page),u=CFNumberCreate(nullptr,kCFNumberIntType,&usage);
 const void* keys[]={CFSTR(kIOHIDDeviceUsagePageKey),CFSTR(kIOHIDDeviceUsageKey)};const void* values[]={p,u};
 CFDictionaryRef match=CFDictionaryCreate(nullptr,keys,values,2,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);IOHIDManagerSetDeviceMatching(manager,match);CFRelease(match);CFRelease(p);CFRelease(u);
 IOHIDManagerRegisterDeviceMatchingCallback(manager,added,nullptr);IOHIDManagerRegisterDeviceRemovalCallback(manager,removed,nullptr);IOHIDManagerRegisterInputValueCallback(manager,input,nullptr);
 IOHIDManagerScheduleWithRunLoop(manager,runloop,kCFRunLoopDefaultMode);
 if(IOHIDManagerOpen(manager,kIOHIDOptionsTypeNone)!=kIOReturnSuccess){emit("{\"type\":\"error\"}");CFRelease(manager);return 1;}
 CFSetRef existing=IOHIDManagerCopyDevices(manager);if(existing){CFIndex count=CFSetGetCount(existing);std::vector<const void*> devices(count);CFSetGetValues(existing,devices.data());for(auto item:devices)added(nullptr,kIOReturnSuccess,nullptr,(IOHIDDeviceRef)item);CFRelease(existing);}
 list();emit("{\"type\":\"ready\",\"monotonicMs\":"+std::to_string(tick())+"}");
 std::thread([]{std::string line;while(std::getline(std::cin,line)){}CFRunLoopStop(runloop);}).detach();CFRunLoopRun();
 IOHIDManagerUnscheduleFromRunLoop(manager,runloop,kCFRunLoopDefaultMode);IOHIDManagerClose(manager,kIOHIDOptionsTypeNone);CFRelease(manager);return 0;
}
