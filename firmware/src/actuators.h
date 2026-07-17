#pragma once
#include <Arduino.h>

void initActuators();
void setMotionRelay(bool allowMotion);
void buzzerWrite(bool on);
void buzzerChirp(int count, int delayMs);
void buzzerAlarm(bool active);
void updateRGBLED(uint8_t r, uint8_t g, uint8_t b);
void applyActuatorStates();
void triggerManualSOS();
void clearManualSOS();
void clearTamper();
void safetySupervisorTask(void *pvParameters);
bool isSafetyFaultActive();
bool isOTASafetyFaultActive();
