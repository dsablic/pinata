# knight: drawing guide

Each view at 48 px tall, the camera 14 degrees above the horizon. Positions are pixels from the top-left of the view image; "top faces" is where a two-joint sprite's top row ends up on screen in this view at rest (the sprite is drawn along +x from joint A to joint B).

## front (facing 0 degrees; image front.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| helmet | head | 27.0, 19.2 | - | - | 14.4 | upright |
| plume | plumeFront -> plumeBack | 27.0, 12.5 | 27.0, 12.5 | 0.0 | 3.7, 2.7 | toward the viewer (end-on) |
| torso | pelvis -> chest | 27.8, 36.8 | 27.0, 26.4 | 10.4 | 14.0 (box) | left |
| hips | hipsBottom -> pelvis | 27.8, 40.9 | 27.8, 36.8 | 4.1 | 12.8 (box) | left |
| capeL | capeTopL -> capeHemL | 30.7, 25.7 | 31.3, 46.8 | 21.2 | 8.5 (box) | right |
| capeR | capeTopR -> capeHemR | 23.3, 25.7 | 22.7, 46.8 | 21.2 | 8.5 (box) | right |
| thighL | hipL -> kneeL | 31.3, 37.3 | 31.5, 46.6 | 9.3 | 5.9, 5.3 | right |
| shinL | kneeL -> ankleL | 31.5, 46.6 | 31.5, 55.4 | 8.8 | 5.3, 4.5 | right |
| footL | ankleL -> toeL | 31.5, 55.4 | 32.1, 57.1 | 1.8 | 4.8, 4.0 | right |
| thighR | hipR -> kneeR | 24.3, 37.3 | 23.8, 46.7 | 9.4 | 5.9, 5.3 | right |
| shinR | kneeR -> ankleR | 23.8, 46.7 | 23.3, 55.9 | 9.2 | 5.3, 4.5 | right |
| footR | ankleR -> toeR | 23.3, 55.9 | 22.5, 57.5 | 1.8 | 4.8, 4.0 | down-right |
| pauldronL | shoulderL | 35.8, 27.5 | - | - | 6.9 | upright |
| upperArmL | shoulderL -> elbowL | 35.8, 27.5 | 37.1, 33.5 | 6.2 | 5.6, 5.1 | right |
| forearmL | elbowL -> wristL | 37.1, 33.5 | 35.8, 38.6 | 5.2 | 4.5, 4.0 | right |
| handL | handL | 35.3, 39.9 | - | - | 5.3 | upright |
| pauldronR | shoulderR | 18.2, 27.5 | - | - | 6.9 | upright |
| upperArmR | shoulderR -> elbowR | 18.2, 27.5 | 17.1, 33.7 | 6.3 | 5.6, 5.1 | right |
| forearmR | elbowR -> wristR | 17.1, 33.7 | 16.9, 39.5 | 5.8 | 4.5, 4.0 | right |
| handR | handR | 16.9, 41.1 | - | - | 5.3 | upright |
| sword | handR -> swordTip | 16.9, 41.1 | 15.0, 52.8 | 11.8 | 1.9, 1.6 | right |

## frontSide (facing 45 degrees; image frontSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| helmet | head | 27.0, 19.2 | - | - | 14.4 | upright |
| plume | plumeFront -> plumeBack | 28.5, 12.3 | 22.5, 12.9 | 6.1 | 3.7, 2.7 | down |
| torso | pelvis -> chest | 27.6, 36.6 | 27.0, 26.4 | 10.2 | 15.9 (box) | left |
| hips | hipsBottom -> pelvis | 27.6, 40.8 | 27.6, 36.6 | 4.1 | 14.7 (box) | left |
| capeL | capeTopL -> capeHemL | 25.9, 25.4 | 23.8, 46.7 | 21.4 | 8.4 (box) | right |
| capeR | capeTopR -> capeHemR | 20.6, 26.7 | 17.8, 48.2 | 21.7 | 6.2 (box) | right |
| thighL | hipL -> kneeL | 30.0, 36.6 | 30.2, 45.8 | 9.3 | 5.9, 5.3 | right |
| shinL | kneeL -> ankleL | 30.2, 45.8 | 30.2, 54.6 | 8.8 | 5.3, 4.5 | right |
| footL | ankleL -> toeL | 30.2, 54.6 | 33.6, 55.9 | 3.6 | 4.8, 4.0 | up |
| thighR | hipR -> kneeR | 25.1, 37.8 | 26.4, 47.1 | 9.4 | 5.9, 5.3 | right |
| shinR | kneeR -> ankleR | 26.4, 47.1 | 25.7, 56.4 | 9.3 | 5.3, 4.5 | right |
| footR | ankleR -> toeR | 25.7, 56.4 | 27.9, 57.8 | 2.7 | 4.8, 4.0 | up-right |
| pauldronL | shoulderL | 33.2, 26.0 | - | - | 6.9 | upright |
| upperArmL | shoulderL -> elbowL | 33.2, 26.0 | 35.3, 31.7 | 6.1 | 5.6, 5.1 | right |
| forearmL | elbowL -> wristL | 35.3, 31.7 | 37.0, 36.7 | 5.3 | 4.5, 4.0 | right |
| handL | handL | 37.4, 38.0 | - | - | 5.3 | upright |
| pauldronR | shoulderR | 20.8, 29.0 | - | - | 6.9 | upright |
| upperArmR | shoulderR -> elbowR | 20.8, 29.0 | 20.0, 35.4 | 6.4 | 5.6, 5.1 | right |
| forearmR | elbowR -> wristR | 20.0, 35.4 | 20.2, 41.2 | 5.8 | 4.5, 4.0 | right |
| handR | handR | 20.4, 42.8 | - | - | 5.3 | upright |
| sword | handR -> swordTip | 20.4, 42.8 | 29.8, 53.7 | 14.4 | 1.9, 1.6 | up-right |

## side (facing 90 degrees; image side.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| helmet | head | 26.0, 19.2 | - | - | 14.4 | upright |
| plume | plumeFront -> plumeBack | 28.1, 11.9 | 19.6, 14.0 | 8.8 | 3.7, 2.7 | down |
| torso | pelvis -> chest | 26.0, 36.6 | 26.0, 26.4 | 10.2 | 8.5 (box) | left |
| hips | hipsBottom -> pelvis | 26.0, 40.7 | 26.0, 36.6 | 4.1 | 8.0 (box) | left |
| capeL | capeTopL -> capeHemL | 20.7, 26.0 | 17.2, 47.9 | 22.1 | 4.8 (box) | right |
| capeR | capeTopR -> capeHemR | 20.7, 27.9 | 17.2, 50.0 | 22.4 | 5.3 (box) | right |
| thighL | hipL -> kneeL | 26.0, 36.3 | 26.0, 45.5 | 9.3 | 5.9, 5.3 | right |
| shinL | kneeL -> ankleL | 26.0, 45.5 | 26.0, 54.3 | 8.8 | 5.3, 4.5 | right |
| footL | ankleL -> toeL | 26.0, 54.3 | 30.3, 54.8 | 4.3 | 4.8, 4.0 | up |
| thighR | hipR -> kneeR | 26.0, 37.9 | 28.4, 46.9 | 9.2 | 5.9, 5.3 | right |
| shinR | kneeR -> ankleR | 28.4, 46.9 | 27.9, 56.3 | 9.5 | 5.3, 4.5 | right |
| footR | ankleR -> toeR | 27.9, 56.3 | 31.9, 57.2 | 4.1 | 4.8, 4.0 | up |
| pauldronL | shoulderL | 26.0, 25.3 | - | - | 6.9 | upright |
| upperArmL | shoulderL -> elbowL | 26.0, 25.3 | 27.6, 30.7 | 5.6 | 5.6, 5.1 | right |
| forearmL | elbowL -> wristL | 27.6, 30.7 | 31.3, 35.2 | 5.8 | 4.5, 4.0 | up-right |
| handL | handL | 32.4, 36.3 | - | - | 5.3 | upright |
| pauldronR | shoulderR | 26.0, 29.6 | - | - | 6.9 | upright |
| upperArmR | shoulderR -> elbowR | 26.0, 29.6 | 26.0, 36.1 | 6.5 | 5.6, 5.1 | right |
| forearmR | elbowR -> wristR | 26.0, 36.1 | 26.5, 41.8 | 5.8 | 4.5, 4.0 | right |
| handR | handR | 26.8, 43.4 | - | - | 5.3 | upright |
| sword | handR -> swordTip | 26.8, 43.4 | 42.0, 51.8 | 17.4 | 1.9, 1.6 | up-right |

## backSide (facing 135 degrees; image backSide.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| helmet | head | 30.0, 18.2 | - | - | 14.4 | upright |
| plume | plumeFront -> plumeBack | 31.5, 10.6 | 25.5, 14.1 | 7.0 | 3.7, 2.7 | down-right |
| torso | pelvis -> chest | 29.4, 35.6 | 30.0, 25.4 | 10.2 | 15.9 (box) | left |
| hips | hipsBottom -> pelvis | 29.4, 39.8 | 29.4, 35.6 | 4.1 | 14.7 (box) | left |
| capeL | capeTopL -> capeHemL | 23.6, 26.2 | 20.8, 48.7 | 22.7 | 6.5 (box) | right |
| capeR | capeTopR -> capeHemR | 28.9, 27.5 | 26.8, 50.2 | 22.8 | 8.5 (box) | right |
| thighL | hipL -> kneeL | 27.0, 35.6 | 26.8, 44.8 | 9.3 | 5.9, 5.3 | right |
| shinL | kneeL -> ankleL | 26.8, 44.8 | 26.8, 53.6 | 8.8 | 5.3, 4.5 | right |
| footL | ankleL -> toeL | 26.8, 53.6 | 29.4, 53.5 | 2.6 | 4.8, 4.0 | up |
| thighR | hipR -> kneeR | 31.9, 36.8 | 34.0, 45.2 | 8.7 | 5.9, 5.3 | right |
| shinR | kneeR -> ankleR | 34.0, 45.2 | 34.0, 54.7 | 9.5 | 5.3, 4.5 | right |
| footR | ankleR -> toeR | 34.0, 54.7 | 37.4, 54.8 | 3.4 | 4.8, 4.0 | up |
| pauldronL | shoulderL | 23.8, 25.0 | - | - | 6.9 | upright |
| upperArmL | shoulderL -> elbowL | 23.8, 25.0 | 24.0, 30.2 | 5.2 | 5.6, 5.1 | right |
| forearmL | elbowL -> wristL | 24.0, 30.2 | 27.5, 33.9 | 5.2 | 4.5, 4.0 | up-right |
| handL | handL | 28.7, 34.8 | - | - | 5.3 | upright |
| pauldronR | shoulderR | 36.2, 28.0 | - | - | 6.9 | upright |
| upperArmR | shoulderR -> elbowR | 36.2, 28.0 | 37.0, 34.4 | 6.4 | 5.6, 5.1 | right |
| forearmR | elbowR -> wristR | 37.0, 34.4 | 37.5, 40.0 | 5.7 | 4.5, 4.0 | right |
| handR | handR | 37.7, 41.5 | - | - | 5.3 | upright |
| sword | handR -> swordTip | 37.7, 41.5 | 49.8, 47.3 | 13.4 | 1.9, 1.6 | up-right |

## back (facing 180 degrees; image back.png)

| Part | Joints A -> B | A (px) | B (px) | Bone (px) | Width at A, B (px) | Top faces |
|---|---|---|---|---|---|---|
| helmet | head | 27.0, 18.2 | - | - | 14.4 | upright |
| plume | plumeFront -> plumeBack | 27.0, 10.4 | 27.0, 14.6 | 4.1 | 3.7, 2.7 | right |
| torso | pelvis -> chest | 26.2, 35.8 | 27.0, 25.4 | 10.4 | 14.0 (box) | left |
| hips | hipsBottom -> pelvis | 26.2, 39.9 | 26.2, 35.8 | 4.1 | 12.8 (box) | left |
| capeL | capeTopL -> capeHemL | 23.3, 27.2 | 22.7, 50.1 | 22.8 | 8.5 (box) | right |
| capeR | capeTopR -> capeHemR | 30.7, 27.2 | 31.3, 50.1 | 22.8 | 8.5 (box) | right |
| thighL | hipL -> kneeL | 22.7, 36.3 | 22.5, 45.6 | 9.3 | 5.9, 5.3 | right |
| shinL | kneeL -> ankleL | 22.5, 45.6 | 22.5, 54.4 | 8.8 | 5.3, 4.5 | right |
| footL | ankleL -> toeL | 22.5, 54.4 | 21.9, 54.0 | 0.7 | 4.8, 4.0 | down-left |
| thighR | hipR -> kneeR | 29.7, 36.3 | 30.2, 44.5 | 8.2 | 5.9, 5.3 | right |
| shinR | kneeR -> ankleR | 30.2, 44.5 | 30.7, 54.0 | 9.5 | 5.3, 4.5 | right |
| footR | ankleR -> toeR | 30.7, 54.0 | 31.5, 53.6 | 0.9 | 4.8, 4.0 | up |
| pauldronL | shoulderL | 18.2, 26.5 | - | - | 6.9 | upright |
| upperArmL | shoulderL -> elbowL | 18.2, 26.5 | 16.9, 31.8 | 5.5 | 5.6, 5.1 | right |
| forearmL | elbowL -> wristL | 16.9, 31.8 | 18.2, 35.0 | 3.5 | 4.5, 4.0 | right |
| handL | handL | 18.7, 35.8 | - | - | 5.3 | upright |
| pauldronR | shoulderR | 35.8, 26.5 | - | - | 6.9 | upright |
| upperArmR | shoulderR -> elbowR | 35.8, 26.5 | 36.9, 32.7 | 6.3 | 5.6, 5.1 | right |
| forearmR | elbowR -> wristR | 36.9, 32.7 | 37.1, 38.2 | 5.6 | 4.5, 4.0 | right |
| handR | handR | 37.1, 39.7 | - | - | 5.3 | upright |
| sword | handR -> swordTip | 37.1, 39.7 | 39.0, 44.1 | 4.7 | 1.9, 1.6 | up-right |

