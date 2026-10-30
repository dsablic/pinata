# rogue: drawing guide

Each view at 48 px tall, the camera 14 degrees above the horizon. Positions are pixels from the top-left of the view image; "top faces" is where a two-joint sprite's top row ends up on screen in this view at rest (the sprite is drawn along +x from joint A to joint B).

## front (facing 0 degrees; image front.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 22.0, 34.8 | 22.0, 22.4 | 12.4 | 12.0 (box) | left |
| head | head | 22.0, 17.0 | - | - | 13.6 | upright |
| hood | head -> hoodPeak | 22.0, 17.0 | 22.0, 13.9 | 3.1 | 13.6, 11.2 | left |
| face | face | 22.0, 18.2 | - | - | 7.2 | upright |
| scarfWrap | scarfL -> scarfR | 26.8, 21.8 | 17.2, 21.8 | 9.6 | 4.8, 4.8 | down |
| scarfTail | scarfAnchor -> scarfEnd | 26.0, 21.4 | 26.0, 25.1 | 3.7 | 3.6, 3.6 | right |
| thighL | hipL -> kneeL | 25.2, 35.6 | 25.2, 44.4 | 8.8 | 4.8, 4.0 | right |
| shinL | kneeL -> ankleL | 25.2, 44.4 | 25.2, 52.7 | 8.2 | 4.0, 4.0 | right |
| footL | ankleL -> toeL | 25.2, 52.7 | 25.2, 54.6 | 1.9 | 4.8, 3.2 | right |
| thighR | hipR -> kneeR | 18.8, 35.6 | 18.8, 44.4 | 8.8 | 4.8, 4.0 | right |
| shinR | kneeR -> ankleR | 18.8, 44.4 | 18.8, 52.7 | 8.2 | 4.0, 4.0 | right |
| footR | ankleR -> toeR | 18.8, 52.7 | 18.8, 54.6 | 1.9 | 4.8, 3.2 | right |
| shoulderL | shoulderL | 30.8, 24.0 | - | - | 5.6 | upright |
| upperArmL | shoulderL -> elbowL | 30.8, 24.0 | 32.0, 31.1 | 7.3 | 4.0, 3.6 | right |
| forearmL | elbowL -> wristL | 32.0, 31.1 | 32.4, 37.7 | 6.6 | 3.6, 3.6 | right |
| handL | handL | 32.4, 39.5 | - | - | 5.2 | upright |
| shoulderR | shoulderR | 13.2, 24.0 | - | - | 5.6 | upright |
| upperArmR | shoulderR -> elbowR | 13.2, 24.0 | 12.0, 31.1 | 7.3 | 4.0, 3.6 | right |
| forearmR | elbowR -> wristR | 12.0, 31.1 | 11.6, 37.7 | 6.6 | 3.6, 3.6 | right |
| handR | handR | 11.6, 39.5 | - | - | 5.2 | upright |

## frontSide (facing 45 degrees; image frontSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 20.0, 34.8 | 20.0, 22.4 | 12.4 | 14.7 (box) | left |
| head | head | 20.0, 17.0 | - | - | 13.6 | upright |
| hood | head -> hoodPeak | 20.0, 17.0 | 17.7, 14.1 | 3.7 | 13.6, 11.2 | down-left |
| face | face | 22.5, 18.0 | - | - | 7.2 | upright |
| scarfWrap | scarfL -> scarfR | 24.0, 20.9 | 17.2, 22.6 | 7.0 | 4.8, 4.8 | down |
| scarfTail | scarfAnchor -> scarfEnd | 20.0, 21.0 | 17.2, 25.0 | 4.9 | 3.6, 3.6 | down-right |
| thighL | hipL -> kneeL | 22.3, 35.0 | 23.1, 43.8 | 8.8 | 4.8, 4.0 | right |
| shinL | kneeL -> ankleL | 23.1, 43.8 | 22.3, 52.1 | 8.4 | 4.0, 4.0 | right |
| footL | ankleL -> toeL | 22.3, 52.1 | 25.7, 53.7 | 3.8 | 4.8, 3.2 | up-right |
| thighR | hipR -> kneeR | 17.7, 36.1 | 18.6, 44.9 | 8.8 | 4.8, 4.0 | right |
| shinR | kneeR -> ankleR | 18.6, 44.9 | 17.7, 53.2 | 8.4 | 4.0, 4.0 | right |
| footR | ankleR -> toeR | 17.7, 53.2 | 21.1, 54.8 | 3.8 | 4.8, 3.2 | up-right |
| shoulderL | shoulderL | 26.2, 22.4 | - | - | 5.6 | upright |
| upperArmL | shoulderL -> elbowL | 26.2, 22.4 | 27.6, 29.4 | 7.1 | 4.0, 3.6 | right |
| forearmL | elbowL -> wristL | 27.6, 29.4 | 29.1, 35.8 | 6.6 | 3.6, 3.6 | right |
| handL | handL | 29.6, 37.5 | - | - | 5.2 | upright |
| shoulderR | shoulderR | 13.8, 25.5 | - | - | 5.6 | upright |
| upperArmR | shoulderR -> elbowR | 13.8, 25.5 | 13.5, 32.8 | 7.3 | 4.0, 3.6 | right |
| forearmR | elbowR -> wristR | 13.5, 32.8 | 14.3, 39.3 | 6.6 | 3.6, 3.6 | right |
| handR | handR | 14.9, 41.0 | - | - | 5.2 | upright |

## side (facing 90 degrees; image side.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 17.0, 33.8 | 17.0, 21.4 | 12.4 | 8.8 (box) | left |
| head | head | 17.0, 16.0 | - | - | 13.6 | upright |
| hood | head -> hoodPeak | 17.0, 16.0 | 13.8, 13.6 | 4.0 | 13.6, 11.2 | down-left |
| face | face | 20.6, 16.4 | - | - | 7.2 | upright |
| scarfWrap | scarfL -> scarfR | 17.8, 19.5 | 17.8, 21.8 | 2.3 | 4.8, 4.8 | right |
| scarfTail | scarfAnchor -> scarfEnd | 13.0, 20.4 | 9.0, 25.1 | 6.1 | 3.6, 3.6 | down-right |
| thighL | hipL -> kneeL | 17.0, 33.8 | 18.2, 42.4 | 8.6 | 4.8, 4.0 | right |
| shinL | kneeL -> ankleL | 18.2, 42.4 | 17.0, 50.9 | 8.6 | 4.0, 4.0 | right |
| footL | ankleL -> toeL | 17.0, 50.9 | 21.8, 51.7 | 4.9 | 4.8, 3.2 | up |
| thighR | hipR -> kneeR | 17.0, 35.4 | 18.2, 43.9 | 8.6 | 4.8, 4.0 | right |
| shinR | kneeR -> ankleR | 18.2, 43.9 | 17.0, 52.4 | 8.6 | 4.0, 4.0 | right |
| footR | ankleR -> toeR | 17.0, 52.4 | 21.8, 53.2 | 4.9 | 4.8, 3.2 | up |
| shoulderL | shoulderL | 17.0, 20.8 | - | - | 5.6 | upright |
| upperArmL | shoulderL -> elbowL | 17.0, 20.8 | 17.8, 27.5 | 6.7 | 4.0, 3.6 | right |
| forearmL | elbowL -> wristL | 17.8, 27.5 | 19.4, 33.6 | 6.3 | 3.6, 3.6 | right |
| handL | handL | 20.2, 35.2 | - | - | 5.2 | upright |
| shoulderR | shoulderR | 17.0, 25.1 | - | - | 5.6 | upright |
| upperArmR | shoulderR -> elbowR | 17.0, 25.1 | 17.8, 32.4 | 7.3 | 4.0, 3.6 | right |
| forearmR | elbowR -> wristR | 17.8, 32.4 | 19.4, 38.7 | 6.5 | 3.6, 3.6 | right |
| handR | handR | 20.2, 40.2 | - | - | 5.2 | upright |

## backSide (facing 135 degrees; image backSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 20.0, 33.8 | 20.0, 21.4 | 12.4 | 14.7 (box) | left |
| head | head | 20.0, 16.0 | - | - | 13.6 | upright |
| hood | head -> hoodPeak | 20.0, 16.0 | 17.7, 14.2 | 2.9 | 13.6, 11.2 | down-left |
| face | face | 22.5, 15.7 | - | - | 7.2 | upright |
| scarfWrap | scarfL -> scarfR | 17.2, 19.7 | 24.0, 21.3 | 7.0 | 4.8, 4.8 | up |
| scarfTail | scarfAnchor -> scarfEnd | 14.3, 21.4 | 11.5, 26.7 | 6.0 | 3.6, 3.6 | down-right |
| thighL | hipL -> kneeL | 17.7, 34.0 | 18.6, 42.4 | 8.4 | 4.8, 4.0 | right |
| shinL | kneeL -> ankleL | 18.6, 42.4 | 17.7, 51.1 | 8.8 | 4.0, 4.0 | right |
| footL | ankleL -> toeL | 17.7, 51.1 | 21.1, 51.1 | 3.4 | 4.8, 3.2 | up |
| thighR | hipR -> kneeR | 22.3, 35.1 | 23.1, 43.5 | 8.4 | 4.8, 4.0 | right |
| shinR | kneeR -> ankleR | 23.1, 43.5 | 22.3, 52.2 | 8.8 | 4.0, 4.0 | right |
| footR | ankleR -> toeR | 22.3, 52.2 | 25.7, 52.2 | 3.4 | 4.8, 3.2 | up |
| shoulderL | shoulderL | 13.8, 21.4 | - | - | 5.6 | upright |
| upperArmL | shoulderL -> elbowL | 13.8, 21.4 | 13.5, 28.1 | 6.7 | 4.0, 3.6 | right |
| forearmL | elbowL -> wristL | 13.5, 28.1 | 14.3, 34.0 | 5.9 | 3.6, 3.6 | right |
| handL | handL | 14.9, 35.4 | - | - | 5.2 | upright |
| shoulderR | shoulderR | 26.2, 24.5 | - | - | 5.6 | upright |
| upperArmR | shoulderR -> elbowR | 26.2, 24.5 | 27.6, 31.5 | 7.2 | 4.0, 3.6 | right |
| forearmR | elbowR -> wristR | 27.6, 31.5 | 29.1, 37.5 | 6.2 | 3.6, 3.6 | right |
| handR | handR | 29.6, 38.9 | - | - | 5.2 | upright |

## back (facing 180 degrees; image back.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| torso | pelvis -> chest | 22.0, 33.8 | 22.0, 21.4 | 12.4 | 12.0 (box) | left |
| head | head | 22.0, 16.0 | - | - | 13.6 | upright |
| hood | head -> hoodPeak | 22.0, 16.0 | 22.0, 14.4 | 1.6 | 13.6, 11.2 | left |
| face | face | 22.0, 15.5 | - | - | 7.2 | upright |
| scarfWrap | scarfL -> scarfR | 17.2, 20.4 | 26.8, 20.4 | 9.6 | 4.8, 4.8 | up |
| scarfTail | scarfAnchor -> scarfEnd | 18.0, 22.4 | 18.0, 28.0 | 5.6 | 3.6, 3.6 | right |
| thighL | hipL -> kneeL | 18.8, 34.6 | 18.8, 42.8 | 8.2 | 4.8, 4.0 | right |
| shinL | kneeL -> ankleL | 18.8, 42.8 | 18.8, 51.7 | 8.8 | 4.0, 4.0 | right |
| footL | ankleL -> toeL | 18.8, 51.7 | 18.8, 51.3 | 0.4 | 4.8, 3.2 | toward the viewer (end-on) |
| thighR | hipR -> kneeR | 25.2, 34.6 | 25.2, 42.8 | 8.2 | 4.8, 4.0 | right |
| shinR | kneeR -> ankleR | 25.2, 42.8 | 25.2, 51.7 | 8.8 | 4.0, 4.0 | right |
| footR | ankleR -> toeR | 25.2, 51.7 | 25.2, 51.3 | 0.4 | 4.8, 3.2 | toward the viewer (end-on) |
| shoulderL | shoulderL | 13.2, 23.0 | - | - | 5.6 | upright |
| upperArmL | shoulderL -> elbowL | 13.2, 23.0 | 12.0, 29.7 | 6.9 | 4.0, 3.6 | right |
| forearmL | elbowL -> wristL | 12.0, 29.7 | 11.6, 35.6 | 5.8 | 3.6, 3.6 | right |
| handL | handL | 11.6, 36.9 | - | - | 5.2 | upright |
| shoulderR | shoulderR | 30.8, 23.0 | - | - | 5.6 | upright |
| upperArmR | shoulderR -> elbowR | 30.8, 23.0 | 32.0, 29.7 | 6.9 | 4.0, 3.6 | right |
| forearmR | elbowR -> wristR | 32.0, 29.7 | 32.4, 35.6 | 5.8 | 3.6, 3.6 | right |
| handR | handR | 32.4, 36.9 | - | - | 5.2 | upright |

