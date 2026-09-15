#include "NannestadCharacter.h"

#include "Animation/AnimInstance.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/InputComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Controller.h"
#include "GameFramework/SpringArmComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogNannestadCharacter, Log, All);

ANannestadCharacter::ANannestadCharacter()
{
    PrimaryActorTick.bCanEverTick = false;
    GetCapsuleComponent()->InitCapsuleSize(42.0f, 94.0f);

    bUseControllerRotationPitch = false;
    bUseControllerRotationYaw = false;
    bUseControllerRotationRoll = false;

    UCharacterMovementComponent* Movement = GetCharacterMovement();
    Movement->bOrientRotationToMovement = true;
    Movement->RotationRate = FRotator(0.0, 500.0, 0.0);
    Movement->JumpZVelocity = 500.0f;
    Movement->AirControl = 0.25f;
    Movement->MaxWalkSpeed = 360.0f;
    Movement->BrakingDecelerationWalking = 1800.0f;

    CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
    CameraBoom->SetupAttachment(RootComponent);
    CameraBoom->TargetArmLength = 450.0f;
    CameraBoom->SocketOffset = FVector(0.0, 55.0, 75.0);
    CameraBoom->bUsePawnControlRotation = true;
    CameraBoom->bEnableCameraLag = true;
    CameraBoom->CameraLagSpeed = 10.0f;

    FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
    FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
    FollowCamera->bUsePawnControlRotation = false;

    HumanMesh = TSoftObjectPtr<USkeletalMesh>(FSoftObjectPath(
        TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple")));
    HumanAnimationBlueprint = TSoftClassPtr<UAnimInstance>(FSoftObjectPath(
        TEXT("/Game/Characters/Mannequins/Animations/ABP_Quinn.ABP_Quinn_C")));
}

void ANannestadCharacter::BeginPlay()
{
    Super::BeginPlay();

    USkeletalMesh* LoadedMesh = HumanMesh.LoadSynchronous();
    UClass* LoadedAnimationClass = HumanAnimationBlueprint.LoadSynchronous();
    if (!LoadedMesh || !LoadedAnimationClass)
    {
        UE_LOG(
            LogNannestadCharacter,
            Error,
            TEXT("Human character assets are missing. Add Epic's Third Person feature content; the game will not pretend the capsule is a human."));
        return;
    }

    USkeletalMeshComponent* CharacterMesh = GetMesh();
    CharacterMesh->SetSkeletalMesh(LoadedMesh);
    CharacterMesh->SetAnimInstanceClass(LoadedAnimationClass);
    CharacterMesh->SetRelativeLocation(FVector(0.0, 0.0, -94.0));
    CharacterMesh->SetRelativeRotation(FRotator(0.0, -90.0, 0.0));
    CharacterMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ANannestadCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    check(PlayerInputComponent);
    PlayerInputComponent->BindAxis(TEXT("MoveForward"), this, &ANannestadCharacter::MoveForward);
    PlayerInputComponent->BindAxis(TEXT("MoveRight"), this, &ANannestadCharacter::MoveRight);
    PlayerInputComponent->BindAxis(TEXT("Turn"), this, &ANannestadCharacter::TurnAtRate);
    PlayerInputComponent->BindAxis(TEXT("LookUp"), this, &ANannestadCharacter::LookUpAtRate);
    PlayerInputComponent->BindAction(TEXT("Jump"), IE_Pressed, this, &ACharacter::Jump);
    PlayerInputComponent->BindAction(TEXT("Jump"), IE_Released, this, &ACharacter::StopJumping);
}

void ANannestadCharacter::MoveForward(const float Value)
{
    if (Controller && !FMath::IsNearlyZero(Value))
    {
        const FRotator Rotation(0.0, Controller->GetControlRotation().Yaw, 0.0);
        AddMovementInput(FRotationMatrix(Rotation).GetUnitAxis(EAxis::X), Value);
    }
}

void ANannestadCharacter::MoveRight(const float Value)
{
    if (Controller && !FMath::IsNearlyZero(Value))
    {
        const FRotator Rotation(0.0, Controller->GetControlRotation().Yaw, 0.0);
        AddMovementInput(FRotationMatrix(Rotation).GetUnitAxis(EAxis::Y), Value);
    }
}

void ANannestadCharacter::TurnAtRate(const float Value)
{
    AddControllerYawInput(Value);
}

void ANannestadCharacter::LookUpAtRate(const float Value)
{
    AddControllerPitchInput(Value);
}
