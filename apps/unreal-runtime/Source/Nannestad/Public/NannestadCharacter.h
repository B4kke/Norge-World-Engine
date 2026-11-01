#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "NannestadCharacter.generated.h"

class UAnimInstance;
class UCameraComponent;
class USkeletalMesh;
class USpringArmComponent;

/** Code-owned third-person character; animation remains presentation state. */
UCLASS()
class NANNESTAD_API ANannestadCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    ANannestadCharacter();

protected:
    virtual void BeginPlay() override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

private:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera", meta = (AllowPrivateAccess = "true"))
    TObjectPtr<USpringArmComponent> CameraBoom;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera", meta = (AllowPrivateAccess = "true"))
    TObjectPtr<UCameraComponent> FollowCamera;

    UPROPERTY(EditDefaultsOnly, Category = "Character|Human")
    TSoftObjectPtr<USkeletalMesh> HumanMesh;

    UPROPERTY(EditDefaultsOnly, Category = "Character|Human")
    TSoftClassPtr<UAnimInstance> HumanAnimationBlueprint;

    void MoveForward(float Value);
    void MoveRight(float Value);
    void TurnAtRate(float Value);
    void LookUpAtRate(float Value);
};
